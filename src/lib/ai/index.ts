import { GoogleGenAI } from "@google/genai";
import { EMBEDDING_DIMENSIONS, getServerEnv } from "@/lib/env";
import { GatewayEmbeddingProvider, GatewayLLMProvider, GatewaySpeechProvider, gatewayModelId, gatewayTokenSource } from "./gateway";
import { GeminiEmbeddingProvider, GeminiLLMProvider, GeminiSpeechProvider } from "./gemini";
import { AIConfigurationError, type EmbeddingProvider, type LLMProvider, type SpeechProvider } from "./types";

export * from "./types";

export interface AIProviders {
  llm: LLMProvider;
  embeddings: EmbeddingProvider;
  speech: SpeechProvider;
}

/**
 * "none" is a supported mode, not an error: sources are still processed into a
 * keyword index and chat returns matching passages. Only generation features
 * (Studio, audio, summaries) need a provider.
 */
export type AIMode = "gemini" | "gateway" | "none";

export function getAIMode(): AIMode {
  const env = getServerEnv();
  if (env.AI_PROVIDER !== "auto") return env.AI_PROVIDER;
  if (env.GEMINI_API_KEY) return "gemini";
  if (env.AI_GATEWAY_API_KEY) return "gateway";
  return "none";
}

/** True when a model is available for generation (chat answers, Studio, audio). */
export function isAIConfigured(): boolean {
  return getAIMode() !== "none";
}

export interface AIStatus {
  mode: AIMode;
  generation: boolean;
  models: { chat: string; fast: string; embedding: string; tts: string } | null;
}

export function getAIStatus(): AIStatus {
  const mode = getAIMode();
  const env = getServerEnv();
  const id = mode === "gateway" ? gatewayModelId : (m: string) => m;
  return {
    mode,
    generation: mode !== "none",
    models:
      mode === "none"
        ? null
        : { chat: id(env.AI_CHAT_MODEL), fast: id(env.AI_FAST_MODEL), embedding: id(env.AI_EMBEDDING_MODEL), tts: id(env.AI_TTS_MODEL) },
  };
}

export const AI_DISABLED_MESSAGE =
  "AI generation is turned off on this server. Set GEMINI_API_KEY, or enable Vercel AI Gateway (AI_PROVIDER=gateway), to use this feature.";

let cached: { mode: AIMode; providers: AIProviders } | null = null;

function build(mode: Exclude<AIMode, "none">): AIProviders {
  const env = getServerEnv();
  if (env.AI_EMBEDDING_DIMENSIONS !== EMBEDDING_DIMENSIONS) {
    throw new AIConfigurationError(
      `AI_EMBEDDING_DIMENSIONS=${env.AI_EMBEDDING_DIMENSIONS} does not match the database column vector(${EMBEDDING_DIMENSIONS}).`,
    );
  }
  if (mode === "gemini") {
    if (!env.GEMINI_API_KEY) throw new AIConfigurationError("AI_PROVIDER=gemini but GEMINI_API_KEY is not set.");
    const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    return {
      llm: new GeminiLLMProvider(client, env.AI_CHAT_MODEL, env.AI_FAST_MODEL),
      embeddings: new GeminiEmbeddingProvider(client, env.AI_EMBEDDING_MODEL, env.AI_EMBEDDING_DIMENSIONS),
      speech: new GeminiSpeechProvider(client, env.AI_TTS_MODEL),
    };
  }
  const client = { token: gatewayTokenSource(env.AI_GATEWAY_API_KEY) };
  return {
    llm: new GatewayLLMProvider(client, env.AI_CHAT_MODEL, env.AI_FAST_MODEL),
    embeddings: new GatewayEmbeddingProvider(client, env.AI_EMBEDDING_MODEL, env.AI_EMBEDDING_DIMENSIONS),
    speech: new GatewaySpeechProvider(client, env.AI_TTS_MODEL),
  };
}

/** Providers for the configured mode, or null when running without AI. */
export function getOptionalAIProviders(): AIProviders | null {
  const mode = getAIMode();
  if (mode === "none") return null;
  if (cached?.mode !== mode) cached = { mode, providers: build(mode) };
  return cached.providers;
}

/** For generation-only features: throws a 503-mapped error when AI is off. */
export function getAIProviders(): AIProviders {
  const providers = getOptionalAIProviders();
  if (!providers) throw new AIConfigurationError(AI_DISABLED_MESSAGE);
  return providers;
}
