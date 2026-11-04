import { requireUser } from "@/lib/api/auth";
import { errorResponse, HttpError, json, notFound, parseId } from "@/lib/api/http";
import { getServerEnv } from "@/lib/env";
import { scheduleSourceProcessing } from "@/lib/jobs";
import { enforceRateLimit } from "@/lib/usage";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/** A source stuck in "processing" longer than this is considered abandoned. */
const STALE_MS = 10 * 60 * 1000;

/**
 * Re-runs ingestion for a failed or stuck source, or re-processes a ready one
 * (for example to add AI embeddings to a source indexed while AI was off).
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Source");
    const ctx = await requireUser();
    const { data: source, error } = await ctx.supabase
      .from("sources")
      .select("id, notebook_id, status, processing_started_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!source) throw notFound("Source");
    const startedAt = source.processing_started_at ? new Date(source.processing_started_at as string).getTime() : 0;
    if ((source.status === "processing" || source.status === "pending") && Date.now() - startedAt < STALE_MS) {
      throw new HttpError(409, "This source is still being processed.", "in_progress");
    }
    await enforceRateLimit(ctx.supabase, ctx.user.id, "ingest", getServerEnv().RATE_LIMIT_INGEST_PER_HOUR, 3600);
    await ctx.supabase.from("sources").update({ status: "pending", error: null }).eq("id", id);
    scheduleSourceProcessing({ accessToken: ctx.accessToken, userId: ctx.user.id }, source.notebook_id as string, [id]);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "source.retry");
  }
}
