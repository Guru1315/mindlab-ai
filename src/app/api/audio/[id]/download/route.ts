import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api/auth";
import { errorResponse, notFound, parseId } from "@/lib/api/http";
import { signedUrl } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

/** Redirects to a short-lived signed URL that downloads the MP3 as an attachment. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Audio");
    const { supabase } = await requireUser();
    const { data } = await supabase.from("audio_generations").select("storage_path, title, status").eq("id", id).maybeSingle();
    if (!data?.storage_path || data.status !== "ready") throw notFound("Audio");
    const name = `${String(data.title ?? "audio-overview").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "audio-overview"}.mp3`;
    return NextResponse.redirect(await signedUrl(supabase, "audio", data.storage_path as string, { download: name }), { status: 302 });
  } catch (error) {
    return errorResponse(error, "audio.download");
  }
}
