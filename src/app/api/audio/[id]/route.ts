import { requireUser } from "@/lib/api/auth";
import { errorResponse, json, notFound, parseId } from "@/lib/api/http";
import { removeStorageFiles, signedUrl } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

/** Generation status (polled by the UI) plus a signed playback URL when ready. */
export async function GET(request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Audio");
    const { supabase } = await requireUser();
    const { data, error } = await supabase.from("audio_generations").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw notFound("Audio");
    const download = new URL(request.url).searchParams.get("download") === "1";
    let url: string | null = null;
    if (data.status === "ready" && data.storage_path) {
      const name = `${String(data.title ?? "audio-overview").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "audio-overview"}.mp3`;
      url = await signedUrl(supabase, "audio", data.storage_path as string, download ? { download: name } : undefined);
    }
    return json({ audio: { ...data, url } });
  } catch (error) {
    return errorResponse(error, "audio.get");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Audio");
    const { supabase } = await requireUser();
    const { data, error } = await supabase.from("audio_generations").delete().eq("id", id).select("storage_path").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw notFound("Audio");
    if (data.storage_path) await removeStorageFiles(supabase, "audio", [data.storage_path as string]);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "audio.delete");
  }
}
