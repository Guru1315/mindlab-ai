import { requireUser } from "@/lib/api/auth";
import { errorResponse, json } from "@/lib/api/http";

/**
 * Full-text search across the content of all the user's notebooks
 * (optionally one notebook). Uses the generated tsvector column on chunks.
 */
export async function GET(request: Request) {
  try {
    const { supabase } = await requireUser();
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
    const notebookId = url.searchParams.get("notebookId");
    if (q.length < 2) return json({ results: [] });

    let query = supabase
      .from("document_chunks")
      .select("id, source_id, notebook_id, content, page_start, char_start, char_end, sources!inner(title, kind), notebooks!inner(title, emoji)")
      .textSearch("fts", q, { type: "websearch", config: "english" })
      .limit(30);
    if (notebookId && /^[0-9a-f-]{36}$/i.test(notebookId)) query = query.eq("notebook_id", notebookId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return json({ results: data ?? [] });
  } catch (error) {
    return errorResponse(error, "search");
  }
}
