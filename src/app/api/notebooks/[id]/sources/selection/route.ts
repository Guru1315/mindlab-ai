import { z } from "zod";
import { requireNotebook, requireUser } from "@/lib/api/auth";
import { errorResponse, json, parseId, readJson } from "@/lib/api/http";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({ selected: z.boolean() });

/** Select or deselect every source in the notebook. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const notebookId = parseId((await params).id, "Notebook");
    const { supabase } = await requireUser();
    const { selected } = await readJson(request, schema);
    await requireNotebook(supabase, notebookId);
    const { error } = await supabase.from("sources").update({ is_selected: selected }).eq("notebook_id", notebookId);
    if (error) throw new Error(error.message);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "sources.selection");
  }
}
