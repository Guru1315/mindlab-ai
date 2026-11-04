import { z } from "zod";

/**
 * Public (browser-safe) configuration. Only NEXT_PUBLIC_* values belong here;
 * they are inlined at build time, so they must be read via literal property access.
 */
export function getPublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return {
    supabaseUrl: url ?? "",
    supabaseKey: key ?? "",
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    isSupabaseConfigured: Boolean(url && key),
  };
}

const serverSchema = z.object({
  /**
   * Which AI backend to use:
   * - auto (default): Gemini if GEMINI_API_KEY is set, else Vercel AI Gateway
   *   if AI_GATEWAY_API_KEY is set, else no AI (keyword search mode).
   * - gemini | gateway | none: force a backend. "gateway" on Vercel needs no
   *   key: it authenticates with the deployment's OIDC token.
   */
  AI_PROVIDER: z.enum(["auto", "gemini", "gateway", "none"]).default("auto"),
  GEMINI_API_KEY: z.string().optional(),
  AI_GATEWAY_API_KEY: z.string().optional(),
  AI_CHAT_MODEL: z.string().default("gemini-3.8-flash"),
  AI_FAST_MODEL: z.string().default("gemini-3.5-flash-lite"),
  AI_EMBEDDING_MODEL: z.string().default("gemini-embedding-2"),
  AI_EMBEDDING_DIMENSIONS: z.coerce.number().int().default(768),
  AI_TTS_MODEL: z.string().default("gemini-3.8-flash-tts"),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
  MAX_SOURCES_PER_NOTEBOOK: z.coerce.number().int().positive().default(50),
  RATE_LIMIT_CHAT_PER_HOUR: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_GENERATION_PER_HOUR: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_AUDIO_PER_DAY: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_INGEST_PER_HOUR: z.coerce.number().int().positive().default(60),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (!cached) {
    cached = serverSchema.parse(process.env);
  }
  return cached;
}

/** The database column is vector(768); a different dimension would fail at insert time. */
export const EMBEDDING_DIMENSIONS = 768;
