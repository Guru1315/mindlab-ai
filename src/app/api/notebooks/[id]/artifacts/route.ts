import { z } from "zod";
import { getAIProviders } from "@/lib/ai";
import { requireNotebook, requireUser } from "@/lib/api/auth";
import { errorResponse, json, parseId, readJson } from "@/lib/api/http";
import { getServerEnv } from "@/lib/env";
import { scheduleArtifactGeneration } from "@/lib/jobs";
import { STUDIO_DEFINITIONS } from "@/lib/studio/definitions";
import { ARTIFACT_TYPES } from "@/lib/types";
import { ValidationError } from "@/lib/ingestion/validation";
import { enforceRateLimit } from "@/lib/usage";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  type: z.enum(ARTIFACT_TYPES),
  sourceIds: z.array(z.string().uuid()).min(1, "Select at least one source.").max(300),
  focus: z.string().trim().max(500).optional(),
});

export async function GET(_request: Request, { params }: Params) {
  try {
    const notebookId = parseId((await params).id, "Notebook");
    const { supabase } = await requireUser();
    await requireNotebook(supabase, notebookId);
    const { data, error } = await supabase
      .from("generated_artifacts")
      .select("*")
      .eq("notebook_id", notebookId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return json({ artifacts: data });
  } catch (error) {
    return errorResponse(error, "artifacts.list");
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const notebookId = parseId((await params).id, "Notebook");
    const ctx = await requireUser();
    const body = await readJson(request, createSchema);
    await requireNotebook(ctx.supabase, notebookId);
    getAIProviders();
    await enforceRateLimit(ctx.supabase, ctx.user.id, "generation", getServerEnv().RATE_LIMIT_GENERATION_PER_HOUR, 3600);

    const { data: ready } = await ctx.supabase
      .from("sources")
      .select("id")
      .eq("notebook_id", notebookId)
      .eq("status", "ready")
      .in("id", body.sourceIds);
    const sourceIds = (ready ?? []).map((s) => s.id as string);
    const def = STUDIO_DEFINITIONS[body.type];
    if (sourceIds.length === 0) throw new ValidationError("Select at least one processed source.");
    if (def.minSources && sourceIds.length < def.minSources) {
      throw new ValidationError(`${def.label} needs at least ${def.minSources} processed sources selected.`);
    }

    const { data: artifact, error } = await ctx.supabase
      .from("generated_artifacts")
      .insert({
        notebook_id: notebookId,
        user_id: ctx.user.id,
        type: body.type,
        title: def.defaultTitle,
        status: "generating",
        source_ids: sourceIds,
      })
      .select("*")
      .single();
    if (error || !artifact) throw new Error(error?.message ?? "Could not create artifact");

    scheduleArtifactGeneration(
      { accessToken: ctx.accessToken, userId: ctx.user.id },
      { id: artifact.id, notebookId, type: body.type, sourceIds, focus: body.focus },
    );
    return json({ artifact }, { status: 202 });
  } catch (error) {
    return errorResponse(error, "artifacts.create");
  }
}
