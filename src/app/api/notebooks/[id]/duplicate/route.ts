import { requireNotebook, requireUser } from "@/lib/api/auth";
import { errorResponse, json, parseId } from "@/lib/api/http";
import { logger } from "@/lib/logger";

export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

const CHUNK_PAGE = 500;

/**
 * Copies a notebook with its sources (including stored files and embedded
 * chunks, so nothing needs re-processing) and its Studio artifacts.
 * Chat history and audio are not copied.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Notebook");
    const { supabase, user } = await requireUser();
    const original = (await requireNotebook(supabase, id, "*")) as Record<string, unknown>;

    const { data: copy, error } = await supabase
      .from("notebooks")
      .insert({
        user_id: user.id,
        title: `${String(original.title).slice(0, 190)} (copy)`,
        description: original.description,
        emoji: original.emoji,
        summary: original.summary,
        suggested_questions: original.suggested_questions,
      })
      .select("*")
      .single();
    if (error || !copy) throw new Error(error?.message ?? "Could not duplicate notebook");

    const { data: sources } = await supabase.from("sources").select("*").eq("notebook_id", id).eq("status", "ready");
    for (const source of sources ?? []) {
      let storagePath: string | null = null;
      if (source.storage_path) {
        const fileName = String(source.storage_path).split("/").pop();
        storagePath = `${user.id}/${copy.id}/${crypto.randomUUID()}-${fileName}`;
        const { error: copyError } = await supabase.storage.from("sources").copy(source.storage_path, storagePath);
        if (copyError) {
          logger.warn("duplicate.file_copy_failed", { error: copyError.message });
          storagePath = null;
        }
      }
      const fields: Record<string, unknown> = { ...source };
      delete fields.id;
      delete fields.created_at;
      delete fields.updated_at;
      const { data: newSource, error: sourceError } = await supabase
        .from("sources")
        .insert({ ...fields, notebook_id: copy.id, storage_path: storagePath })
        .select("id")
        .single();
      if (sourceError || !newSource) throw new Error(sourceError?.message ?? "Could not copy source");

      for (let from = 0; ; from += CHUNK_PAGE) {
        const { data: chunks, error: chunkError } = await supabase
          .from("document_chunks")
          .select("chunk_index, content, page_start, page_end, char_start, char_end, token_count, embedding")
          .eq("source_id", source.id)
          .order("chunk_index")
          .range(from, from + CHUNK_PAGE - 1);
        if (chunkError) throw new Error(chunkError.message);
        if (!chunks?.length) break;
        const { error: insertError } = await supabase
          .from("document_chunks")
          .insert(chunks.map((c) => ({ ...c, source_id: newSource.id, notebook_id: copy.id, user_id: user.id })));
        if (insertError) throw new Error(insertError.message);
        if (chunks.length < CHUNK_PAGE) break;
      }
    }

    const { data: artifacts } = await supabase.from("generated_artifacts").select("type, title, content, data, model").eq("notebook_id", id).eq("status", "ready");
    if (artifacts?.length) {
      await supabase
        .from("generated_artifacts")
        .insert(artifacts.map((a) => ({ ...a, notebook_id: copy.id, user_id: user.id, status: "ready" })));
    }

    return json({ notebook: copy }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "notebook.duplicate");
  }
}
