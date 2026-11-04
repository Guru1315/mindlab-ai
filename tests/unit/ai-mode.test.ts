import { afterEach, describe, expect, it, vi } from "vitest";

/** getServerEnv caches the parsed env, so each case loads a fresh module graph. */
async function loadAI(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of ["AI_PROVIDER", "GEMINI_API_KEY", "AI_GATEWAY_API_KEY"]) vi.stubEnv(key, env[key] ?? "");
  // Empty strings mean "unset" for the optional keys.
  if (!env.AI_PROVIDER) delete process.env.AI_PROVIDER;
  if (!env.GEMINI_API_KEY) delete process.env.GEMINI_API_KEY;
  if (!env.AI_GATEWAY_API_KEY) delete process.env.AI_GATEWAY_API_KEY;
  return import("@/lib/ai");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AI provider selection", () => {
  it("runs in search mode (no AI) when nothing is configured", async () => {
    const ai = await loadAI({});
    expect(ai.getAIMode()).toBe("none");
    expect(ai.isAIConfigured()).toBe(false);
    expect(ai.getOptionalAIProviders()).toBeNull();
    expect(() => ai.getAIProviders()).toThrow(/AI generation is turned off/);
    expect(ai.getAIStatus()).toEqual({ mode: "none", generation: false, models: null });
  });

  it("prefers Gemini when a key is set", async () => {
    const ai = await loadAI({ GEMINI_API_KEY: "test-key", AI_GATEWAY_API_KEY: "gw" });
    expect(ai.getAIMode()).toBe("gemini");
    expect(ai.getOptionalAIProviders()?.llm.name).toBe("gemini");
  });

  it("uses Vercel AI Gateway with a gateway key and reports gateway model ids", async () => {
    const ai = await loadAI({ AI_GATEWAY_API_KEY: "gw-key" });
    expect(ai.getAIMode()).toBe("gateway");
    expect(ai.getOptionalAIProviders()?.embeddings.name).toBe("vercel-ai-gateway");
    expect(ai.getAIStatus().models?.chat).toBe("google/gemini-3.8-flash");
  });

  it("honours an explicit AI_PROVIDER (gateway via OIDC needs no key)", async () => {
    const gateway = await loadAI({ AI_PROVIDER: "gateway" });
    expect(gateway.getAIMode()).toBe("gateway");
    expect(gateway.getOptionalAIProviders()?.speech.name).toBe("vercel-ai-gateway");

    const none = await loadAI({ AI_PROVIDER: "none", GEMINI_API_KEY: "test-key" });
    expect(none.getAIMode()).toBe("none");
  });

  it("fails clearly when forced to Gemini without a key", async () => {
    const ai = await loadAI({ AI_PROVIDER: "gemini" });
    expect(() => ai.getOptionalAIProviders()).toThrow(/GEMINI_API_KEY is not set/);
  });
});
