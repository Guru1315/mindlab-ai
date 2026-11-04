import { GoogleGenAI, type Content, type GenerateContentResponse } from "@google/genai";
import { isTransientError, withRetry } from "@/lib/retry";
import { GEMINI_VOICES } from "./voices";
import {
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
 * Gemini implementations of the provider interfaces, using the official
 * @google/genai SDK (models.generateContent / embedContent).
 */

function toContents(messages: ChatTurn[]): Content[] {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

function usageOf(response: GenerateContentResponse | undefined): TokenUsage {
  return {
    inputTokens: response?.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: response?.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

function assertNotBlocked(response: GenerateContentResponse) {
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    throw new AIResponseError(`The request was blocked by the model's safety filters (${blockReason}).`);
  }
}

export class GeminiLLMProvider implements LLMProvider {
  readonly name = "gemini";

  constructor(
    private readonly client: GoogleGenAI,
    readonly defaultModel: string,
    readonly fastModel: string,
  ) {}

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    const model = options.model ?? this.defaultModel;
    const response = await withRetry(
      () =>
        this.client.models.generateContent({
          model,
          contents: toContents(options.messages),
          config: {
            systemInstruction: options.system,
            maxOutputTokens: options.maxOutputTokens,
            abortSignal: options.signal,
          },
        }),
      { signal: options.signal },
    );
    assertNotBlocked(response);
    return { text: response.text ?? "", usage: usageOf(response), model };
  }

  async *streamText(options: GenerateTextOptions): AsyncIterable<TextStreamEvent> {
    const model = options.model ?? this.defaultModel;
    const stream = await withRetry(
      () =>
        this.client.models.generateContentStream({
          model,
          contents: toContents(options.messages),
          config: {
            systemInstruction: options.system,
            maxOutputTokens: options.maxOutputTokens,
            abortSignal: options.signal,
          },
        }),
      { signal: options.signal },
    );
    let last: GenerateContentResponse | undefined;
    for await (const chunk of stream) {
      assertNotBlocked(chunk);
      last = chunk;
      const text = chunk.text;
      if (text) yield { type: "text", text };
    }
    yield { type: "usage", usage: usageOf(last) };
  }

  async generateJson<T>(options: GenerateJsonOptions<T>): Promise<{ data: T; usage: TokenUsage; model: string }> {
    const model = options.model ?? this.defaultModel;
    let lastError: unknown;
    // One extra attempt if the model returns JSON that fails validation.
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await withRetry(
        () =>
          this.client.models.generateContent({
            model,
            contents: toContents(options.messages),
            config: {
              systemInstruction: options.system,
              maxOutputTokens: options.maxOutputTokens,
              responseMimeType: "application/json",
              responseJsonSchema: options.jsonSchema,
              abortSignal: options.signal,
            },
          }),
        { signal: options.signal },
      );
      assertNotBlocked(response);
      try {
        const data = options.parse(JSON.parse(response.text ?? ""));
        return { data, usage: usageOf(response), model };
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

/**
 * gemini-embedding-2 does not accept task_type; the docs instead prescribe
 * task prefixes inside the text. gemini-embedding-001 uses task_type.
 */
export function formatEmbeddingText(model: string, kind: "query" | "document", input: EmbeddingInput): string {
  if (!model.startsWith("gemini-embedding-2")) return input.text;
  if (kind === "query") return `task: search result | query: ${input.text}`;
  const title = input.title?.replace(/\s+/g, " ").trim() || "none";
  return `title: ${title} | text: ${input.text}`;
}

export function l2Normalize(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return norm > 0 ? values.map((v) => v / norm) : values;
}

const EMBED_BATCH_SIZE = 32;

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "gemini";

  constructor(
    private readonly client: GoogleGenAI,
    readonly model: string,
    readonly dimensions: number,
  ) {}

  private async embed(texts: string[], taskType: string, signal?: AbortSignal): Promise<number[][]> {
    const usesTaskType = !this.model.startsWith("gemini-embedding-2");
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      const response = await withRetry(
        () =>
          this.client.models.embedContent({
            model: this.model,
            // One Content per input => one embedding per input.
            contents: batch.map((text) => ({ parts: [{ text }] })),
            config: {
              outputDimensionality: this.dimensions,
              ...(usesTaskType ? { taskType } : {}),
              abortSignal: signal,
            },
          }),
        { signal, retries: 5 },
      );
      const embeddings = response.embeddings ?? [];
      if (embeddings.length !== batch.length) {
        throw new AIResponseError(`Embedding count mismatch: expected ${batch.length}, received ${embeddings.length}.`, true);
      }
      for (const e of embeddings) {
        const values = e.values ?? [];
        if (values.length !== this.dimensions) {
          throw new AIResponseError(`Embedding has ${values.length} dimensions, expected ${this.dimensions}.`);
        }
        // embedding-2 auto-normalizes truncated outputs; embedding-001 does not.
        out.push(l2Normalize(values));
      }
    }
    return out;
  }

  embedDocuments(inputs: EmbeddingInput[], signal?: AbortSignal): Promise<number[][]> {
    return this.embed(
      inputs.map((input) => formatEmbeddingText(this.model, "document", input)),
      "RETRIEVAL_DOCUMENT",
      signal,
    );
  }

  async embedQuery(text: string, signal?: AbortSignal): Promise<number[]> {
    const [vector] = await this.embed([formatEmbeddingText(this.model, "query", { text })], "RETRIEVAL_QUERY", signal);
    return vector;
  }
}

export { GEMINI_VOICES } from "./voices";

/** Parses "audio/L16;codec=pcm;rate=24000" style mime types. */
export function sampleRateFromMime(mimeType: string | undefined, fallback = 24000): number {
  const match = mimeType?.match(/rate=(\d+)/i);
  return match ? Number(match[1]) : fallback;
}

/** Converts base64 audio (raw L16 PCM or a RIFF/WAV container) to PCM samples. */
export function decodeAudioPayload(base64: string, mimeType: string | undefined): SpeechResult {
  const bytes = Buffer.from(base64, "base64");
  let sampleRate = sampleRateFromMime(mimeType);
  let offset = 0;
  let length = bytes.length;
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE") {
    // Walk WAV chunks to find "fmt " and "data".
    let pos = 12;
    while (pos + 8 <= bytes.length) {
      const id = bytes.toString("ascii", pos, pos + 4);
      const size = bytes.readUInt32LE(pos + 4);
      if (id === "fmt ") sampleRate = bytes.readUInt32LE(pos + 12);
      if (id === "data") {
        offset = pos + 8;
        length = Math.min(size, bytes.length - offset);
        break;
      }
      pos += 8 + size + (size % 2);
    }
  }
  const sampleCount = Math.floor(length / 2);
  const pcm = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) pcm[i] = bytes.readInt16LE(offset + i * 2);
  return { pcm, sampleRate };
}

export class GeminiSpeechProvider implements SpeechProvider {
  readonly name = "gemini";
  readonly voices = GEMINI_VOICES;

  constructor(
    private readonly client: GoogleGenAI,
    readonly model: string,
  ) {}

  async synthesize(turns: DialogueTurn[], voiceBySpeaker: Record<string, string>, signal?: AbortSignal): Promise<SpeechResult> {
    const speakers = [...new Set(turns.map((t) => t.speaker))];
    if (speakers.length > 2) throw new AIResponseError("Gemini multi-speaker TTS supports at most two speakers per request.");

    const transcript = turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
    const speechConfig =
      speakers.length === 2
        ? {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: speakers.map((speaker) => ({
                speaker,
                voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceBySpeaker[speaker] ?? "Kore" } },
              })),
            },
          }
        : { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceBySpeaker[speakers[0]] ?? "Kore" } } };

    const prompt =
      speakers.length === 2
        ? `Read this podcast conversation between ${speakers[0]} and ${speakers[1]} naturally, with warm, engaged, conversational delivery:\n\n${transcript}`
        : `Read this narration naturally, with a warm, clear and engaging delivery:\n\n${turns.map((t) => t.text).join("\n")}`;

    const response = await withRetry(
      () =>
        this.client.models.generateContent({
          model: this.model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: { responseModalities: ["AUDIO"], speechConfig, abortSignal: signal },
        }),
      { signal, retries: 4, shouldRetry: (e) => isTransientError(e) },
    );
    const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) {
      throw new AIResponseError("The speech model returned no audio.", true);
    }
    return decodeAudioPayload(part.inlineData.data, part.inlineData.mimeType);
  }
}
