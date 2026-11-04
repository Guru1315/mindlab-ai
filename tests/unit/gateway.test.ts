import { describe, expect, it } from "vitest";
import { z } from "zod";
import { encodeWav } from "@/lib/audio/encode";
import { jsonSchemaFor } from "@/lib/ai/schema";
import {
  GatewayEmbeddingProvider,
  GatewayLLMProvider,
  GatewaySpeechProvider,
  gatewayModelId,
  readSse,
  stripJsonFence,
  type GatewayClient,
} from "@/lib/ai/gateway";
import { AIConfigurationError } from "@/lib/ai/types";

interface Recorded {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Fake gateway: records requests and answers with scripted responses. */
function fakeGateway(handler: (req: Recorded, n: number) => Response | Promise<Response>) {
  const requests: Recorded[] = [];
  const client: GatewayClient = {
    token: async () => "test-oidc-token",
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const req = {
        url: String(url),
        headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
        body: JSON.parse(String(init?.body ?? "{}")),
      };
      requests.push(req);
      return handler(req, requests.length);
    }) as typeof fetch,
  };
  return { client, requests };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function sse(events: unknown[]): Response {
  const text = events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
  return new Response(new TextEncoder().encode(text), { headers: { "content-type": "text/event-stream" } });
}

describe("gateway helpers", () => {
  it("prefixes bare Gemini model ids with the google/ provider", () => {
    expect(gatewayModelId("gemini-3.8-flash")).toBe("google/gemini-3.8-flash");
    expect(gatewayModelId("openai/text-embedding-3-small")).toBe("openai/text-embedding-3-small");
  });

  it("strips Markdown fences around JSON", () => {
    expect(stripJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripJsonFence('{"a":1}')).toBe('{"a":1}');
  });

  it("parses SSE streams split across chunks", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode('data: {"x":1}\n\nda'));
        c.enqueue(encoder.encode('ta: {"x":2}\n\ndata: [DONE]\n\n'));
        c.close();
      },
    });
    const out = [];
    for await (const e of readSse(body)) out.push(e);
    expect(out).toEqual([{ x: 1 }, { x: 2 }]);
  });
});

describe("GatewayLLMProvider", () => {
  it("sends OpenAI-style chat completions with the OIDC token and a system message", async () => {
    const { client, requests } = fakeGateway(() =>
      json({ choices: [{ message: { content: "Hello" } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }),
    );
    const llm = new GatewayLLMProvider(client, "gemini-3.8-flash", "gemini-3.5-flash-lite");
    const result = await llm.generateText({ system: "Be brief.", messages: [{ role: "user", content: "Hi" }], maxOutputTokens: 50 });
    expect(result).toEqual({ text: "Hello", usage: { inputTokens: 12, outputTokens: 3 }, model: "gemini-3.8-flash" });
    expect(requests[0].url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions");
    expect(requests[0].headers.Authorization).toBe("Bearer test-oidc-token");
    expect(requests[0].body).toMatchObject({
      model: "google/gemini-3.8-flash",
      max_tokens: 50,
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hi" },
      ],
    });
  });

  it("streams text deltas and reports usage", async () => {
    const { client, requests } = fakeGateway(() =>
      sse([
        { choices: [{ delta: { content: "Chloro" } }] },
        { choices: [{ delta: { content: "phyll [1]." } }] },
        { choices: [], usage: { prompt_tokens: 40, completion_tokens: 6 } },
        "[DONE]",
      ]),
    );
    const llm = new GatewayLLMProvider(client, "gemini-3.8-flash", "fast");
    const events = [];
    for await (const e of llm.streamText({ messages: [{ role: "user", content: "q" }] })) events.push(e);
    expect(events).toEqual([
      { type: "text", text: "Chloro" },
      { type: "text", text: "phyll [1]." },
      { type: "usage", usage: { inputTokens: 40, outputTokens: 6 } },
    ]);
    expect(requests[0].body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it("requests JSON-schema output, tolerates fences and retries once on invalid JSON", async () => {
    const { client, requests } = fakeGateway((_req, n) =>
      json({ choices: [{ message: { content: n === 1 ? "not json" : '```json\n{"answer":"five"}\n```' } }] }),
    );
    const schema = z.object({ answer: z.string() });
    const llm = new GatewayLLMProvider(client, "chat", "fast");
    const result = await llm.generateJson({ messages: [{ role: "user", content: "x" }], jsonSchema: jsonSchemaFor(schema), parse: (v) => schema.parse(v) });
    expect(result.data).toEqual({ answer: "five" });
    expect(requests).toHaveLength(2);
    expect(requests[0].body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "result" } });
  });

  it("explains when the team has not enabled AI Gateway billing", async () => {
    const { client } = fakeGateway(() =>
      json({ error: { type: "customer_verification_required", message: "AI Gateway requires a valid credit card on file" } }, 403),
    );
    const llm = new GatewayLLMProvider(client, "chat", "fast");
    const error = await llm.generateText({ messages: [{ role: "user", content: "x" }] }).catch((e) => e);
    expect(error).toBeInstanceOf(AIConfigurationError);
    expect(error.message).toMatch(/credit card/);
  });

  it("retries rate-limited requests", async () => {
    const { client, requests } = fakeGateway((_req, n) => (n === 1 ? json({ error: { message: "slow down" } }, 429) : json({ choices: [{ message: { content: "ok" } }] })));
    const llm = new GatewayLLMProvider(client, "chat", "fast");
    await expect(llm.generateText({ messages: [{ role: "user", content: "x" }] })).resolves.toMatchObject({ text: "ok" });
    expect(requests).toHaveLength(2);
  });
});

describe("GatewayEmbeddingProvider", () => {
  it("requests 768 dimensions in batches, orders by index, normalizes and uses embedding-2 prefixes", async () => {
    const { client, requests } = fakeGateway((req) => {
      const input = req.body.input as string[];
      // Return rows out of order to check sorting by index.
      return json({ data: input.map((_, i) => ({ index: i, embedding: new Array(768).fill(i + 1) })).reverse() });
    });
    const provider = new GatewayEmbeddingProvider(client, "gemini-embedding-2", 768);
    const vectors = await provider.embedDocuments(Array.from({ length: 40 }, (_, i) => ({ title: "Doc", text: `t${i}` })));
    expect(vectors).toHaveLength(40);
    expect(requests).toHaveLength(2);
    expect(requests[0].body).toMatchObject({ model: "google/gemini-embedding-2", dimensions: 768 });
    expect((requests[0].body.input as string[])[0]).toBe("title: Doc | text: t0");
    expect(Math.hypot(...vectors[0])).toBeCloseTo(1);

    await provider.embedQuery("What is ATP?");
    expect((requests[2].body.input as string[])[0]).toBe("task: search result | query: What is ATP?");
  });

  it("rejects vectors of the wrong size", async () => {
    const { client } = fakeGateway(() => json({ data: [{ index: 0, embedding: [1, 2, 3] }] }));
    await expect(new GatewayEmbeddingProvider(client, "gemini-embedding-2", 768).embedQuery("x")).rejects.toThrow(/3 dimensions/);
  });
});

describe("GatewaySpeechProvider", () => {
  it("synthesizes each speaker run with its own voice and stitches the PCM", async () => {
    const wav = Buffer.from(encodeWav(new Int16Array(240).fill(100), 24000)).toString("base64");
    const { client, requests } = fakeGateway(() => json({ audio: wav, mediaType: "audio/wav" }));
    const tts = new GatewaySpeechProvider(client, "gemini-3.8-flash-tts");
    const result = await tts.synthesize(
      [
        { speaker: "Alex", text: "Hello." },
        { speaker: "Alex", text: "Welcome back." },
        { speaker: "Sam", text: "Thanks!" },
      ],
      { Alex: "Kore", Sam: "Puck" },
    );
    expect(requests).toHaveLength(2); // consecutive Alex lines are merged
    expect(requests[0].url).toBe("https://ai-gateway.vercel.sh/v4/ai/speech-model");
    expect(requests[0].headers["ai-model-id"]).toBe("google/gemini-3.8-flash-tts");
    expect(requests[0].body).toEqual({ text: "Hello.\nWelcome back.", voice: "Kore", outputFormat: "wav" });
    expect(requests[1].body).toMatchObject({ text: "Thanks!", voice: "Puck" });
    expect(result.sampleRate).toBe(24000);
    expect(result.pcm.length).toBe(240 * 2 + Math.round(24000 * 0.15));
  });

  it("rejects audio formats it cannot decode", async () => {
    const { client } = fakeGateway(() => json({ audio: Buffer.from("ID3....").toString("base64"), mediaType: "audio/mpeg" }));
    await expect(new GatewaySpeechProvider(client, "tts").synthesize([{ speaker: "A", text: "x" }], {})).rejects.toThrow(/Unsupported audio format/);
  });
});
