import { z } from "zod";
import { getAIProviders } from "@/lib/ai";
import { requireNotebook, requireUser } from "@/lib/api/auth";
import { errorResponse, json, parseId, readJson } from "@/lib/api/http";
import { GEMINI_VOICES } from "@/lib/ai/voices";
import { getServerEnv } from "@/lib/env";
import { ValidationError } from "@/lib/ingestion/validation";
import { scheduleAudioGeneration } from "@/lib/jobs";
import { signedUrl } from "@/lib/storage";
import type { AudioGeneration } from "@/lib/types";
import { enforceRateLimit } from "@/lib/usage";

// Script generation + multi-segment TTS can take a few minutes. 300 s is the
// Vercel Hobby ceiling; raise it (up to 800 on Pro with Fluid compute) if needed.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const voice = z.enum(GEMINI_VOICES);

const createSchema = z.object({
  format: z.enum(["deep_dive", "brief", "debate", "critique"]).default("deep_dive"),
  length: z.enum(["short", "default", "long"]).default("default"),
  focus: z.string().trim().max(1000).optional(),
  sourceIds: z.array(z.string().uuid()).min(1, "Select at least one source.").max(300),
  hostVoice: voice.optional(),
  guestVoice: voice.optional(),
});

export async function GET(_request: Request, { params }: Params) {
  try {
    const notebookId = parseId((await params).id, "Notebook");
    const { supabase } = await requireUser();
    await requireNotebook(supabase, notebookId);
    const { data, error } = await supabase
      .from("audio_generations")
      .select("*")
      .eq("notebook_id", notebookId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    const items = await Promise.all(
      (data as AudioGeneration[]).map(async (a) => ({
        ...a,
        url: a.status === "ready" && a.storage_path ? await signedUrl(supabase, "audio", a.storage_path).catch(() => null) : null,
      })),
    );
    return json({ audio: items });
  } catch (error) {
    return errorResponse(error, "audio.list");
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const notebookId = parseId((await params).id, "Notebook");
    const ctx = await requireUser();
    const body = await readJson(request, createSchema);
    await requireNotebook(ctx.supabase, notebookId);
    getAIProviders();
    await enforceRateLimit(ctx.supabase, ctx.user.id, "audio", getServerEnv().RATE_LIMIT_AUDIO_PER_DAY, 86400);

    const { data: ready } = await ctx.supabase
      .from("sources")
      .select("id")
      .eq("notebook_id", notebookId)
      .eq("status", "ready")
      .in("id", body.sourceIds);
    const sourceIds = (ready ?? []).map((s) => s.id as string);
    if (sourceIds.length === 0) throw new ValidationError("Select at least one processed source.");

    const { data: settings } = await ctx.supabase.from("user_settings").select("audio_host_voice, audio_guest_voice").eq("user_id", ctx.user.id).maybeSingle();
    const voices = {
      host: body.hostVoice ?? (settings?.audio_host_voice as string) ?? "Kore",
      guest: body.guestVoice ?? (settings?.audio_guest_voice as string) ?? "Puck",
    };

    const { data: generation, error } = await ctx.supabase
      .from("audio_generations")
      .insert({
        notebook_id: notebookId,
        user_id: ctx.user.id,
        status: "queued",
        format: body.format,
        length: body.length,
        focus_prompt: body.focus || null,
        source_ids: sourceIds,
        voices,
      })
      .select("*")
      .single();
    if (error || !generation) throw new Error(error?.message ?? "Could not start audio generation");

    // Counts toward the daily audio limit from the moment it is queued.
    await ctx.supabase.from("usage_records").insert({ user_id: ctx.user.id, notebook_id: notebookId, kind: "audio", units: 1 });

    scheduleAudioGeneration(
      { accessToken: ctx.accessToken, userId: ctx.user.id },
      {
        id: generation.id,
        userId: ctx.user.id,
        notebookId,
        format: body.format,
        length: body.length,
        focus: body.focus ?? null,
        voices,
      },
      sourceIds,
    );
    return json({ audio: { ...generation, url: null } }, { status: 202 });
  } catch (error) {
    return errorResponse(error, "audio.create");
  }
}
