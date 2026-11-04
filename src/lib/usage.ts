import type { SupabaseClient } from "@supabase/supabase-js";
import { RateLimitError } from "@/lib/api/http";
import { logger } from "@/lib/logger";

export type UsageKind = "chat" | "embedding" | "generation" | "tts" | "ingest" | "audio";

export interface UsageRecord {
  kind: UsageKind;
  notebookId?: string | null;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  units?: number;
  metadata?: Record<string, unknown>;
}

/** Appends a usage row. Failures are logged but never break the user's request. */
export async function recordUsage(supabase: SupabaseClient, userId: string, record: UsageRecord) {
  const { error } = await supabase.from("usage_records").insert({
    user_id: userId,
    notebook_id: record.notebookId ?? null,
    kind: record.kind,
    model: record.model ?? null,
    input_tokens: Math.max(0, Math.round(record.inputTokens ?? 0)),
    output_tokens: Math.max(0, Math.round(record.outputTokens ?? 0)),
    units: Math.max(0, Math.round(record.units ?? 0)),
    metadata: record.metadata ?? {},
  });
  if (error) logger.warn("usage.record_failed", { kind: record.kind, error: error.message });
}

/**
 * Sliding-window rate limit backed by usage_records. Users cannot delete their
 * usage rows (RLS has no delete policy), so the limit cannot be reset client-side,
 * and it holds across serverless instances.
 */
export async function enforceRateLimit(
  supabase: SupabaseClient,
  userId: string,
  kind: UsageKind,
  limit: number,
  windowSeconds: number,
) {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count, error } = await supabase
    .from("usage_records")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind)
    .gte("created_at", since);
  if (error) {
    logger.warn("ratelimit.check_failed", { kind, error: error.message });
    return;
  }
  if ((count ?? 0) >= limit) {
    const window = windowSeconds >= 86400 ? "day" : "hour";
    throw new RateLimitError(`You've reached the limit of ${limit} ${kind} requests per ${window}. Please try again later.`, Math.min(windowSeconds, 3600));
  }
}
