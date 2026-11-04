import { z } from "zod";
import { requireNotebook, requireUser } from "@/lib/api/auth";
import { errorResponse, json, parseId, readJson } from "@/lib/api/http";
import { removeStorageFiles } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).nullable(),
    emoji: z.string().trim().min(1).max(16),
    is_archived: z.boolean(),
    touch: z.literal(true),
  })
  .partial();

export async function GET(_request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Notebook");
    const { supabase } = await requireUser();
    const notebook = await requireNotebook(supabase, id, "*");
    return json({ notebook });
  } catch (error) {
    return errorResponse(error, "notebook.get");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Notebook");
    const { supabase } = await requireUser();
    const { touch, ...body } = await readJson(request, patchSchema);
    await requireNotebook(supabase, id);
    const patch: Record<string, unknown> = { ...body };
    if (touch) patch.last_opened_at = new Date().toISOString();
    if (Object.keys(patch).length === 0) return json({ ok: true });
    const { data, error } = await supabase.from("notebooks").update(patch).eq("id", id).select("*").single();
    if (error) throw new Error(error.message);
    return json({ notebook: data });
  } catch (error) {
    return errorResponse(error, "notebook.patch");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Notebook");
    const { supabase } = await requireUser();
    await requireNotebook(supabase, id);
    const [{ data: sources }, { data: audio }] = await Promise.all([
      supabase.from("sources").select("storage_path").eq("notebook_id", id).not("storage_path", "is", null),
      supabase.from("audio_generations").select("storage_path").eq("notebook_id", id).not("storage_path", "is", null),
    ]);
    // Rows cascade from the notebook; stored files are removed explicitly.
    const { error } = await supabase.from("notebooks").delete().eq("id", id);
    if (error) throw new Error(error.message);
    await removeStorageFiles(supabase, "sources", (sources ?? []).map((s) => s.storage_path as string));
    await removeStorageFiles(supabase, "audio", (audio ?? []).map((a) => a.storage_path as string));
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "notebook.delete");
  }
}
