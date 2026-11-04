import type { GoogleGenAI } from "@google/genai";
import { describe, expect, it } from "vitest";
import { encodeWav } from "@/lib/audio/encode";
import {
  decodeAudioPayload,
  formatEmbeddingText,
  GeminiEmbeddingProvider,
  GeminiLLMProvider,
  GeminiSpeechProvider,
  l2Normalize,
  sampleRateFromMime,
} from "@/lib/ai/gemini";
import { jsonSchemaFor } from "@/lib/ai/schema";
import { z } from "zod";

/** Minimal stand-in for the SDK's `models` surface, recording requests. */
function fakeClient(models: Record<string, (req: Record<string, unknown>) => Promise<unknown>>) {
  const requests: Record<string, unknown>[] = [];
  const wrapped = Object.fromEntries(
    Object.entries(models).map(([k, fn]) => [
      k,
      async (req: Record<string, unknown>) => {
        requests.push({ method: k, ...req });
        return fn(req);
      },
    ]),
  );
  return { client: { models: wrapped } as unknown as GoogleGenAI, requests };
}

describe("embedding helpers", () => {
  it("formats gemini-embedding-2 task prefixes per the docs", () => {
    expect(formatEmbeddingText("gemini-embedding-2", "query", { text: "What is ATP?" })).toBe("task: search result | query: What is ATP?");
    expect(formatEmbeddingText("gemini-embedding-2", "document", { title: "Cell  biology", text: "ATP..." })).toBe("title: Cell biology | text: ATP...");
    expect(formatEmbeddingText("gemini-embedding-2", "document", { text: "x" })).toBe("title: none | text: x");
    expect(formatEmbeddingText("gemini-embedding-001", "query", { text: "q" })).toBe("q");
  });

  it("L2-normalizes vectors", () => {
    const v = l2Normalize([3, 4]);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
  });
});

describe("GeminiEmbeddingProvider", () => {
  it("sends one Content per input, batches requests and validates dimensions", async () => {
    const { client, requests } = fakeClient({
      embedContent: async (req) => ({
        embeddings: (req.contents as unknown[]).map(() => ({ values: Array.from({ length: 768 }, () => 2) })),
      }),
    });
    const provider = new GeminiEmbeddingProvider(client, "gemini-embedding-2", 768);
    const inputs = Array.from({ length: 70 }, (_, i) => ({ text: `chunk ${i}`, title: "Doc" }));
    const vectors = await provider.embedDocuments(inputs);
    expect(vectors).toHaveLength(70);
    expect(requests).toHaveLength(3); // 32 + 32 + 6
    expect((requests[0].contents as { parts: { text: string }[] }[])[0].parts[0].text).toBe("title: Doc | text: chunk 0");
    expect((requests[0].config as Record<string, unknown>).outputDimensionality).toBe(768);
    expect((requests[0].config as Record<string, unknown>).taskType).toBeUndefined();
    const norm = Math.sqrt(vectors[0].reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1);
  });

  it("uses taskType for gemini-embedding-001", async () => {
    const { client, requests } = fakeClient({ embedContent: async () => ({ embeddings: [{ values: new Array(768).fill(1) }] }) });
    await new GeminiEmbeddingProvider(client, "gemini-embedding-001", 768).embedQuery("hello");
    expect((requests[0].config as Record<string, unknown>).taskType).toBe("RETRIEVAL_QUERY");
  });

  it("rejects responses with the wrong dimensionality", async () => {
    const { client } = fakeClient({ embedContent: async () => ({ embeddings: [{ values: [1, 2, 3] }] }) });
    await expect(new GeminiEmbeddingProvider(client, "gemini-embedding-2", 768).embedQuery("x")).rejects.toThrow(/3 dimensions/);
  });
});

describe("GeminiLLMProvider", () => {
  it("requests JSON with a schema and retries once on invalid output", async () => {
    let n = 0;
    const { client, requests } = fakeClient({
      generateContent: async () => ({ text: n++ === 0 ? '{"answer": 5}' : '{"answer": "five"}', usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } }),
    });
    const llm = new GeminiLLMProvider(client, "chat-model", "fast-model");
    const schema = z.object({ answer: z.string() });
    const result = await llm.generateJson({ messages: [{ role: "user", content: "hi" }], jsonSchema: jsonSchemaFor(schema), parse: (v) => schema.parse(v) });
    expect(result.data.answer).toBe("five");
    expect(requests).toHaveLength(2);
    const config = requests[0].config as Record<string, unknown>;
    expect(config.responseMimeType).toBe("application/json");
    expect((config.responseJsonSchema as Record<string, unknown>).$schema).toBeUndefined();
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it("maps assistant turns to the model role and surfaces safety blocks", async () => {
    const { client, requests } = fakeClient({ generateContent: async () => ({ promptFeedback: { blockReason: "SAFETY" } }) });
    const llm = new GeminiLLMProvider(client, "chat-model", "fast-model");
    await expect(
      llm.generateText({ system: "sys", messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }),
    ).rejects.toThrow(/blocked/);
    expect((requests[0].contents as { role: string }[]).map((c) => c.role)).toEqual(["user", "model"]);
    expect((requests[0].config as Record<string, unknown>).systemInstruction).toBe("sys");
  });
});

describe("speech", () => {
  it("decodes raw L16 PCM payloads", () => {
    const pcm = new Int16Array([0, 1000, -1000, 32767]);
    const b64 = Buffer.from(pcm.buffer).toString("base64");
    const out = decodeAudioPayload(b64, "audio/L16;codec=pcm;rate=24000");
    expect(Array.from(out.pcm)).toEqual([0, 1000, -1000, 32767]);
    expect(out.sampleRate).toBe(24000);
  });

  it("decodes WAV-wrapped payloads and reads the sample rate from the header", () => {
    const wav = encodeWav(new Int16Array([5, -5, 7]), 16000);
    const out = decodeAudioPayload(Buffer.from(wav).toString("base64"), "audio/wav");
    expect(Array.from(out.pcm)).toEqual([5, -5, 7]);
    expect(out.sampleRate).toBe(16000);
  });

  it("parses sample rates from mime types", () => {
    expect(sampleRateFromMime("audio/L16;rate=16000")).toBe(16000);
    expect(sampleRateFromMime(undefined)).toBe(24000);
  });

  it("builds a two-speaker request with the configured voices", async () => {
    const pcm = Buffer.from(new Int16Array([1, 2, 3]).buffer).toString("base64");
    const { client, requests } = fakeClient({
      generateContent: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: pcm, mimeType: "audio/L16;rate=24000" } }] } }] }),
    });
    const tts = new GeminiSpeechProvider(client, "tts-model");
    const result = await tts.synthesize(
      [
        { speaker: "Alex", text: "Hello" },
        { speaker: "Sam", text: "Hi" },
      ],
      { Alex: "Kore", Sam: "Puck" },
    );
    expect(result.pcm).toHaveLength(3);
    const config = requests[0].config as { responseModalities: string[]; speechConfig: { multiSpeakerVoiceConfig: { speakerVoiceConfigs: { speaker: string; voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } }[] } } };
    expect(config.responseModalities).toEqual(["AUDIO"]);
    expect(config.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs.map((s) => [s.speaker, s.voiceConfig.prebuiltVoiceConfig.voiceName])).toEqual([
      ["Alex", "Kore"],
      ["Sam", "Puck"],
    ]);
    expect(JSON.stringify(requests[0].contents)).toContain("Alex: Hello\\nSam: Hi");
  });

  it("refuses more than two speakers", async () => {
    const { client } = fakeClient({ generateContent: async () => ({}) });
    await expect(
      new GeminiSpeechProvider(client, "tts").synthesize(
        [
          { speaker: "A", text: "1" },
          { speaker: "B", text: "2" },
          { speaker: "C", text: "3" },
        ],
        {},
      ),
    ).rejects.toThrow(/two speakers/);
  });
});
