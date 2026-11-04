import { z } from "zod";
import { getAIProviders } from "@/lib/ai";
import { requireUser } from "@/lib/api/auth";
import { errorResponse, HttpError, json, notFound, parseId, readJson } from "@/lib/api/http";
import { getServerEnv } from "@/lib/env";
import { scheduleArtifactGeneration } from "@/lib/jobs";
import type { ArtifactType } from "@/lib/types";
import { enforceRateLimit } from "@/lib/usage";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const schema = z.object({ focus: z.string().trim().max(500).optional() });

export async function POST(request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Artifact");
    const ctx = await requireUser();
    const body = await readJson(request, schema).catch(() => ({ focus: undefined }));
    getAIProviders();
    await enforceRateLimit(ctx.supabase, ctx.user.id, "generation", getServerEnv().RATE_LIMIT_GENERATION_PER_HOUR, 3600);
    const { data: artifact } = await ctx.supabase
      .from("generated_artifacts")
      .select("id, notebook_id, type, source_ids, status")
      .eq("id", id)
      .maybeSingle();
    if (!artifact) throw notFound("Artifact");
    if (artifact.status === "generating") throw new HttpError(409, "This item is already being generated.", "in_progress");
    const { data, error } = await ctx.supabase
      .from("generated_artifacts")
      .update({ status: "generating", error: null })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    scheduleArtifactGeneration(
      { accessToken: ctx.accessToken, userId: ctx.user.id },
      {
        id,
        notebookId: artifact.notebook_id as string,
        type: artifact.type as ArtifactType,
        sourceIds: artifact.source_ids as string[],
        focus: body.focus,
      },
    );
    return json({ artifact: data }, { status: 202 });
  } catch (error) {
    return errorResponse(error, "artifact.regenerate");
  }
}
