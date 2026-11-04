import { GoogleGenAI } from "@google/genai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GeminiEmbeddingProvider, GeminiLLMProvider, GeminiSpeechProvider } from "@/lib/ai/gemini";
import { jsonSchemaFor } from "@/lib/ai/schema";
import { answerQuestion, type AnswerEvent } from "@/lib/rag/answer";
import type { Citation } from "@/lib/types";

/**
 * Live tests against the real Gemini API. They run only when GEMINI_API_KEY is
 * set (e.g. `GEMINI_API_KEY=... npm run test:live`) and are skipped otherwise.
 */
const key = process.env.GEMINI_API_KEY;
const live = describe.skipIf(!key);

const chatModel = process.env.AI_CHAT_MODEL ?? "gemini-3.8-flash";
const fastModel = process.env.AI_FAST_MODEL ?? "gemini-3.5-flash-lite";
const embeddingModel = process.env.AI_EMBEDDING_MODEL ?? "gemini-embedding-2";
const ttsModel = process.env.AI_TTS_MODEL ?? "gemini-3.8-flash-tts";

live("Gemini (live)", () => {
  const client = new GoogleGenAI({ apiKey: key });

  it("embeds documents and queries into normalized 768-d vectors that rank relevant text higher", async () => {
    const embeddings = new GeminiEmbeddingProvider(client, embeddingModel, 768);
    const [photo, finance] = await embeddings.embedDocuments([
      { title: "Biology", text: "Photosynthesis converts sunlight into chemical energy in plants." },
      { title: "Finance", text: "Bond yields rise when central banks increase interest rates." },
    ]);
    const query = await embeddings.embedQuery("How do plants turn light into energy?");
    const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
    expect(query).toHaveLength(768);
    expect(dot(query, photo)).toBeGreaterThan(dot(query, finance));
  });

  it("returns schema-valid structured JSON", async () => {
    const llm = new GeminiLLMProvider(client, chatModel, fastModel);
    const schema = z.object({ capital: z.string(), country: z.string() });
    const { data } = await llm.generateJson({
      model: fastModel,
      messages: [{ role: "user", content: "Return the capital of France as JSON." }],
      jsonSchema: jsonSchemaFor(schema),
      parse: (v) => schema.parse(v),
    });
    expect(data.capital.toLowerCase()).toContain("paris");
  });

  it("answers from passages with valid citations and declines when they lack the answer", async () => {
    const llm = new GeminiLLMProvider(client, chatModel, fastModel);
    const passage: Citation = {
      index: 1,
      chunkId: "c1",
      sourceId: "s1",
      sourceTitle: "Lab manual",
      sourceKind: "text",
      excerpt: "The Zorblax reagent must be stored at exactly 4 °C and turns violet when contaminated.",
      pageStart: null,
      pageEnd: null,
      charStart: 0,
      charEnd: 90,
    };
    const run = async (question: string) => {
      const events: AnswerEvent[] = [];
      for await (const e of answerQuestion(
        { notebookId: "nb", question, sourceIds: ["s1"], history: [] },
        { llm, retriever: { retrieve: async () => [passage] } },
      )) {
        events.push(e);
      }
      return events.find((e) => e.type === "final") as Extract<AnswerEvent, { type: "final" }>;
    };
    const grounded = await run("At what temperature should Zorblax be stored?");
    expect(grounded.text).toMatch(/4\s*°?\s*C/);
    expect(grounded.citations.map((c) => c.index)).toEqual([1]);

    const ungrounded = await run("Who won the 1998 football world cup?");
    expect(ungrounded.text.toLowerCase()).toMatch(/source|don't|do not|not (contain|cover|mention)/);
  });

  it("synthesizes two-speaker speech as PCM audio", async () => {
    const tts = new GeminiSpeechProvider(client, ttsModel);
    const { pcm, sampleRate } = await tts.synthesize(
      [
        { speaker: "Alex", text: "Welcome to the show." },
        { speaker: "Sam", text: "Glad to be here." },
      ],
      { Alex: "Kore", Sam: "Puck" },
    );
    expect(sampleRate).toBeGreaterThan(8000);
    expect(pcm.length / sampleRate).toBeGreaterThan(0.5);
  });
});
