import { z } from "zod";
import { requireUser } from "@/lib/api/auth";
import { errorResponse, json, notFound, parseId, readJson } from "@/lib/api/http";
import { removeStorageFiles } from "@/lib/storage";
import { SOURCE_LIST_COLUMNS } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    is_selected: z.boolean(),
    is_bookmarked: z.boolean(),
  })
  .partial();

/**
 * Full source detail for the viewer, including normalized text and page
 * offsets. With ?chunk=<id>, also returns that chunk's character range so a
 * search result or citation can be highlighted.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Source");
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("sources")
      .select(`${SOURCE_LIST_COLUMNS}, extracted_text, page_offsets`)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw notFound("Source");
    const chunkId = new URL(request.url).searchParams.get("chunk");
    let highlight = null;
    if (chunkId && /^[0-9a-f-]{36}$/i.test(chunkId)) {
      const { data: chunk } = await supabase
        .from("document_chunks")
        .select("char_start, char_end, page_start")
        .eq("id", chunkId)
        .eq("source_id", id)
        .maybeSingle();
      highlight = chunk;
    }
    return json({ source: data, highlight });
  } catch (error) {
    return errorResponse(error, "source.get");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Source");
    const { supabase } = await requireUser();
    const body = await readJson(request, patchSchema);
    const { data, error } = await supabase.from("sources").update(body).eq("id", id).select(SOURCE_LIST_COLUMNS).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw notFound("Source");
    return json({ source: data });
  } catch (error) {
    return errorResponse(error, "source.patch");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Source");
    const { supabase } = await requireUser();
    const { data, error } = await supabase.from("sources").delete().eq("id", id).select("storage_path").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw notFound("Source");
    if (data.storage_path) await removeStorageFiles(supabase, "sources", [data.storage_path as string]);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "source.delete");
  }
}
