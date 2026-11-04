import { concatPcm } from "@/lib/audio/encode";
import { isTransientError, withRetry } from "@/lib/retry";
import { decodeAudioPayload, formatEmbeddingText, l2Normalize } from "./gemini";
import { GEMINI_VOICES } from "./voices";
import {
  AIConfigurationError,
  AIResponseError,
  type ChatTurn,
  type DialogueTurn,
  type EmbeddingInput,
  type EmbeddingProvider,
  type GenerateJsonOptions,
  type GenerateTextOptions,
  type GenerateTextResult,
  type LLMProvider,
  type SpeechProvider,
  type SpeechResult,
  type TextStreamEvent,
  type TokenUsage,
} from "./types";

/**
 * Vercel AI Gateway implementations of the provider interfaces, over its
 * OpenAI-compatible REST API (chat completions, embeddings) and speech
 * endpoint. On Vercel no API key is needed: requests authenticate with the
 * deployment's OIDC token. Locally, use AI_GATEWAY_API_KEY or the token that
 * `vercel env pull` writes to .env.local.
 */

export const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";

export type TokenSource = () => Promise<string>;
export type FetchLike = typeof fetch;

export interface GatewayClient {
  token: TokenSource;
  fetch?: FetchLike;
  baseUrl?: string;
}

/** API key if configured, otherwise the Vercel OIDC token (read per request, never cached). */
export function gatewayTokenSource(apiKey?: string): TokenSource {
  return async () => {
    if (apiKey) return apiKey;
    const { getVercelOidcToken } = await import("@vercel/oidc");
    const token = await getVercelOidcToken().catch(() => "");
    if (!token) {
      throw new AIConfigurationError(
        "Vercel AI Gateway has no credentials here. Deploy on Vercel, set AI_GATEWAY_API_KEY, or run `vercel env pull` for a local OIDC token.",
      );
    }
    return token;
  };
}

/** Gateway model ids are "provider/model"; bare Gemini ids get the google/ prefix. */
export function gatewayModelId(model: string): string {
  return model.includes("/") ? model : `google/${model}`;
}

class GatewayHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GatewayHttpError";
  }
}

async function gatewayRequest(
  client: GatewayClient,
  path: string,
  body: unknown,
  options: { signal?: AbortSignal; headers?: Record<string, string> } = {},
): Promise<Response> {
  const doFetch = client.fetch ?? fetch;
  const response = await doFetch(`${client.baseUrl ?? GATEWAY_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await client.token()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (response.ok) return response;

  const text = await response.text().catch(() => "");
  let type = "";
  let message = text.slice(0, 300);
  try {
    const parsed = JSON.parse(text) as { error?: { type?: string; message?: string } };
    type = parsed.error?.type ?? "";
    message = parsed.error?.message ?? message;
  } catch {
    // Non-JSON error body.
  }
  if (type === "customer_verification_required") {
    throw new AIConfigurationError(
      "Vercel AI Gateway is not enabled for this team yet: add a credit card in the Vercel dashboard (AI Gateway) to unlock its free credits.",
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new AIConfigurationError(`Vercel AI Gateway rejected the credentials (${response.status}).`);
  }
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  throw new GatewayHttpError(`AI Gateway error ${response.status}: ${message}`, response.status, retryable);
}

function toChatMessages(system: string | undefined, messages: ChatTurn[]) {
  return [...(system ? [{ role: "system", content: system }] : []), ...messages.map((m) => ({ role: m.role, content: m.content }))];
}

interface ChatCompletion {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const usageOf = (u: ChatCompletion["usage"]): TokenUsage => ({
  inputTokens: u?.prompt_tokens ?? 0,
  outputTokens: u?.completion_tokens ?? 0,
});

/** Removes a ```json fence some models wrap structured output in. */
export function stripJsonFence(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : text;
}

/** Parses an OpenAI-style SSE stream into JSON payloads. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          if (data) yield JSON.parse(data);
        }
        newline = buffer.indexOf("\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class GatewayLLMProvider implements LLMProvider {
  readonly name = "vercel-ai-gateway";

  constructor(
    private readonly client: GatewayClient,
    readonly defaultModel: string,
    readonly fastModel: string,
  ) {}

  private async complete(options: GenerateTextOptions, extra: Record<string, unknown> = {}): Promise<{ text: string; usage: TokenUsage; model: string }> {
    const model = options.model ?? this.defaultModel;
    const response = await withRetry(
      () =>
        gatewayRequest(
          this.client,
          "/v1/chat/completions",
          {
            model: gatewayModelId(model),
            messages: toChatMessages(options.system, options.messages),
            max_tokens: options.maxOutputTokens,
            ...extra,
          },
          { signal: options.signal },
        ),
      { signal: options.signal },
    );
    const data = (await response.json()) as ChatCompletion;
    return { text: data.choices?.[0]?.message?.content ?? "", usage: usageOf(data.usage), model };
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    return this.complete(options);
  }

  async *streamText(options: GenerateTextOptions): AsyncIterable<TextStreamEvent> {
    const model = options.model ?? this.defaultModel;
    const response = await withRetry(
      () =>
        gatewayRequest(
          this.client,
          "/v1/chat/completions",
          {
            model: gatewayModelId(model),
            messages: toChatMessages(options.system, options.messages),
            max_tokens: options.maxOutputTokens,
            stream: true,
            stream_options: { include_usage: true },
          },
          { signal: options.signal },
        ),
      { signal: options.signal },
    );
    if (!response.body) throw new AIResponseError("AI Gateway returned an empty stream.", true);
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    for await (const event of readSse(response.body)) {
      const chunk = event as ChatCompletion & { choices?: { delta?: { content?: string | null } }[] };
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield { type: "text", text };
      if (chunk.usage) usage = usageOf(chunk.usage);
    }
    yield { type: "usage", usage };
  }

  async generateJson<T>(options: GenerateJsonOptions<T>): Promise<{ data: T; usage: TokenUsage; model: string }> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.complete(options, {
        response_format: { type: "json_schema", json_schema: { name: "result", schema: options.jsonSchema, strict: false } },
      });
      try {
        return { data: options.parse(JSON.parse(stripJsonFence(result.text))), usage: result.usage, model: result.model };
      } catch (error) {
        lastError = error;
      }
    }
    throw new AIResponseError(
      `The model returned output that did not match the expected format: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      true,
    );
  }
}

const EMBED_BATCH_SIZE = 32;

export class GatewayEmbeddingProvider implements EmbeddingProvider {
  readonly name = "vercel-ai-gateway";

  constructor(
    private readonly client: GatewayClient,
    readonly model: string,
    readonly dimensions: number,
  ) {}

  private async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      const response = await withRetry(
        () =>
          gatewayRequest(
            this.client,
            "/v1/embeddings",
            { model: gatewayModelId(this.model), input: batch, dimensions: this.dimensions },
            { signal },
          ),
        { signal, retries: 5 },
      );
      const data = (await response.json()) as { data?: { index: number; embedding: number[] }[] };
      const rows = [...(data.data ?? [])].sort((a, b) => a.index - b.index);
      if (rows.length !== batch.length) {
        throw new AIResponseError(`Embedding count mismatch: expected ${batch.length}, received ${rows.length}.`, true);
      }
      for (const row of rows) {
        if (row.embedding.length !== this.dimensions) {
          throw new AIResponseError(`Embedding has ${row.embedding.length} dimensions, expected ${this.dimensions}.`);
        }
        out.push(l2Normalize(row.embedding));
      }
    }
    return out;
  }

  embedDocuments(inputs: EmbeddingInput[], signal?: AbortSignal): Promise<number[][]> {
    return this.embed(
      inputs.map((input) => formatEmbeddingText(this.model.replace(/^google\//, ""), "document", input)),
      signal,
    );
  }

  async embedQuery(text: string, signal?: AbortSignal): Promise<number[]> {
    const [vector] = await this.embed([formatEmbeddingText(this.model.replace(/^google\//, ""), "query", { text })], signal);
    return vector;
  }
}

/**
 * Text-to-speech through the gateway's speech endpoint. It takes one voice per
 * request, so consecutive lines by the same speaker are grouped and each group
 * is synthesized with that speaker's voice, then stitched together.
 */
export class GatewaySpeechProvider implements SpeechProvider {
  readonly name = "vercel-ai-gateway";
  readonly voices = GEMINI_VOICES;

  constructor(
    private readonly client: GatewayClient,
    readonly model: string,
  ) {}

  private async speak(text: string, voice: string, signal?: AbortSignal): Promise<SpeechResult> {
    const response = await withRetry(
      () =>
        gatewayRequest(
          this.client,
          "/v4/ai/speech-model",
          { text, voice, outputFormat: "wav" },
          {
            signal,
            headers: {
              "ai-gateway-protocol-version": "0.0.1",
              "ai-speech-model-specification-version": "4",
              "ai-model-id": gatewayModelId(this.model),
            },
          },
        ),
      { signal, retries: 4, shouldRetry: (e) => isTransientError(e) },
    );
    const data = (await response.json()) as { audio?: string; mediaType?: string; contentType?: string };
    if (!data.audio) throw new AIResponseError("The speech model returned no audio.", true);
    const bytes = Buffer.from(data.audio, "base64");
    const mime = data.mediaType ?? data.contentType ?? "";
    const isWav = bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF";
    if (!isWav && !/l16|pcm/i.test(mime)) {
      throw new AIResponseError(`Unsupported audio format from the speech model (${mime || "unknown"}).`);
    }
    return decodeAudioPayload(data.audio, isWav ? "audio/wav" : mime);
  }

  async synthesize(turns: DialogueTurn[], voiceBySpeaker: Record<string, string>, signal?: AbortSignal): Promise<SpeechResult> {
    const groups: DialogueTurn[] = [];
    for (const turn of turns) {
      const last = groups[groups.length - 1];
      if (last && last.speaker === turn.speaker) last.text += `\n${turn.text}`;
      else groups.push({ ...turn });
    }
    const parts: SpeechResult[] = [];
    for (const group of groups) {
      parts.push(await this.speak(group.text, voiceBySpeaker[group.speaker] ?? "Kore", signal));
    }
    const sampleRate = parts[0]?.sampleRate ?? 24000;
    if (parts.some((p) => p.sampleRate !== sampleRate)) throw new AIResponseError("Inconsistent sample rates from the speech model.");
    return { pcm: concatPcm(parts.map((p) => p.pcm), sampleRate, 150), sampleRate };
  }
}
