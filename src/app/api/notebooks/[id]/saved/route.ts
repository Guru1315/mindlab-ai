import { requireNotebook, requireUser } from "@/lib/api/auth";
import { errorResponse, json, parseId } from "@/lib/api/http";

type Params = { params: Promise<{ id: string }> };

/** Saved AI responses for a notebook. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const notebookId = parseId((await params).id, "Notebook");
    const { supabase } = await requireUser();
    await requireNotebook(supabase, notebookId);
    const { data, error } = await supabase
      .from("messages")
      .select("id, content, citations, created_at, is_saved")
      .eq("notebook_id", notebookId)
      .eq("is_saved", true)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return json({ messages: data });
  } catch (error) {
    return errorResponse(error, "saved.list");
  }
}
