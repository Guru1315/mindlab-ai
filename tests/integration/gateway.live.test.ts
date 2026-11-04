import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GatewayEmbeddingProvider, GatewayLLMProvider, GatewaySpeechProvider, type GatewayClient } from "@/lib/ai/gateway";
import { jsonSchemaFor } from "@/lib/ai/schema";

/**
 * Live tests against Vercel AI Gateway (small paid requests). They run only
 * with credentials: AI_GATEWAY_API_KEY, or the OIDC token `vercel env pull`
 * writes to .env.local. Run with `npm run test:live:gateway`.
 */
const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
const live = describe.skipIf(!token);

live("Vercel AI Gateway (live)", () => {
  const client: GatewayClient = { token: async () => token! };

  it("generates text and schema-valid JSON", async () => {
    const llm = new GatewayLLMProvider(client, "gemini-3.8-flash", "gemini-3.5-flash-lite");
    const text = await llm.generateText({ model: llm.fastModel, messages: [{ role: "user", content: "Reply with the single word: ok" }], maxOutputTokens: 10 });
    expect(text.text.toLowerCase()).toContain("ok");

    const schema = z.object({ capital: z.string() });
    const { data } = await llm.generateJson({
      model: llm.fastModel,
      messages: [{ role: "user", content: "What is the capital of France? Answer as JSON." }],
      jsonSchema: jsonSchemaFor(schema),
      parse: (v) => schema.parse(v),
      maxOutputTokens: 50,
    });
    expect(data.capital.toLowerCase()).toContain("paris");
  });

  it("streams text", async () => {
    const llm = new GatewayLLMProvider(client, "gemini-3.5-flash-lite", "gemini-3.5-flash-lite");
    let text = "";
    for await (const e of llm.streamText({ messages: [{ role: "user", content: "Count from 1 to 5, separated by spaces." }], maxOutputTokens: 30 })) {
      if (e.type === "text") text += e.text;
    }
    expect(text).toMatch(/1.*2.*3/);
  });

  it("returns normalized 768-d embeddings that rank related text higher", async () => {
    const embeddings = new GatewayEmbeddingProvider(client, "gemini-embedding-2", 768);
    const [plants, bonds] = await embeddings.embedDocuments([
      { title: "Biology", text: "Photosynthesis converts sunlight into chemical energy in plants." },
      { title: "Finance", text: "Bond yields rise when central banks increase interest rates." },
    ]);
    const query = await embeddings.embedQuery("How do plants turn light into energy?");
    const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
    expect(query).toHaveLength(768);
    expect(dot(query, plants)).toBeGreaterThan(dot(query, bonds));
  });

  it("synthesizes two voices as decodable PCM", async () => {
    const tts = new GatewaySpeechProvider(client, "gemini-3.8-flash-tts");
    const { pcm, sampleRate } = await tts.synthesize(
      [
        { speaker: "Alex", text: "Welcome to the show." },
        { speaker: "Sam", text: "Glad to be here." },
      ],
      { Alex: "Kore", Sam: "Puck" },
    );
    expect(sampleRate).toBeGreaterThan(8000);
    expect(pcm.length / sampleRate).toBeGreaterThan(0.8);
  });
});
