import { requireUser } from "@/lib/api/auth";
import { errorResponse, json } from "@/lib/api/http";
import { getServerEnv } from "@/lib/env";

/** Usage over the last 30 days plus storage consumed, for the settings page. */
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const [usage, sources, audio, notebooks] = await Promise.all([
      supabase.from("usage_records").select("kind, input_tokens, output_tokens, units, created_at").eq("user_id", user.id).gte("created_at", since).limit(10000),
      supabase.from("sources").select("file_size, word_count"),
      supabase.from("audio_generations").select("file_size, duration_seconds").eq("status", "ready"),
      supabase.from("notebooks").select("id", { count: "exact", head: true }),
    ]);
    if (usage.error) throw new Error(usage.error.message);

    const byKind: Record<string, { requests: number; inputTokens: number; outputTokens: number; units: number }> = {};
    for (const r of usage.data ?? []) {
      const k = (byKind[r.kind as string] ??= { requests: 0, inputTokens: 0, outputTokens: 0, units: 0 });
      k.requests++;
      k.inputTokens += r.input_tokens as number;
      k.outputTokens += r.output_tokens as number;
      k.units += r.units as number;
    }
    const sourceBytes = (sources.data ?? []).reduce((s, r) => s + Number(r.file_size ?? 0), 0);
    const audioBytes = (audio.data ?? []).reduce((s, r) => s + Number(r.file_size ?? 0), 0);
    const env = getServerEnv();
    return json({
      windowDays: 30,
      byKind,
      storage: {
        sourceBytes,
        audioBytes,
        totalBytes: sourceBytes + audioBytes,
        sources: sources.data?.length ?? 0,
        words: (sources.data ?? []).reduce((s, r) => s + Number(r.word_count ?? 0), 0),
        audioSeconds: (audio.data ?? []).reduce((s, r) => s + Number(r.duration_seconds ?? 0), 0),
        notebooks: notebooks.count ?? 0,
      },
      limits: {
        chatPerHour: env.RATE_LIMIT_CHAT_PER_HOUR,
        generationPerHour: env.RATE_LIMIT_GENERATION_PER_HOUR,
        audioPerDay: env.RATE_LIMIT_AUDIO_PER_DAY,
        ingestPerHour: env.RATE_LIMIT_INGEST_PER_HOUR,
        maxUploadMb: env.MAX_UPLOAD_MB,
        maxSourcesPerNotebook: env.MAX_SOURCES_PER_NOTEBOOK,
      },
    });
  } catch (error) {
    return errorResponse(error, "usage.get");
  }
}
