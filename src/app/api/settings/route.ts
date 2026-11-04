import { z } from "zod";
import { getAIStatus } from "@/lib/ai";
import { GEMINI_VOICES } from "@/lib/ai/voices";
import { requireUser } from "@/lib/api/auth";
import { errorResponse, json, readJson } from "@/lib/api/http";

const MODEL_ID = /^[a-z0-9][a-z0-9.\-]{2,63}$/;

const patchSchema = z.object({
  profile: z.object({ full_name: z.string().trim().max(120).nullable() }).partial().optional(),
  settings: z
    .object({
      theme: z.enum(["system", "light", "dark"]),
      chat_model: z.string().trim().regex(MODEL_ID, "Invalid model id").nullable(),
      chat_style: z.enum(["default", "learning", "custom"]),
      custom_instructions: z.string().trim().max(2000).nullable(),
      response_length: z.enum(["short", "default", "long"]),
      audio_host_voice: z.enum(GEMINI_VOICES),
      audio_guest_voice: z.enum(GEMINI_VOICES),
    })
    .partial()
    .optional(),
});

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const [{ data: profile }, { data: settings }] = await Promise.all([
      supabase.from("profiles").select("id, email, full_name, avatar_url").eq("id", user.id).maybeSingle(),
      supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
    ]);
    const ai = getAIStatus();
    return json({ profile, settings, ai });
  } catch (error) {
    return errorResponse(error, "settings.get");
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await readJson(request, patchSchema);
    if (body.profile && Object.keys(body.profile).length) {
      const { error } = await supabase.from("profiles").update(body.profile).eq("id", user.id);
      if (error) throw new Error(error.message);
    }
    if (body.settings && Object.keys(body.settings).length) {
      const { error } = await supabase.from("user_settings").upsert({ user_id: user.id, ...body.settings });
      if (error) throw new Error(error.message);
    }
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "settings.patch");
  }
}
