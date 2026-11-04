import { getAIProviders } from "@/lib/ai";
import { requireNotebook, requireUser } from "@/lib/api/auth";
import { errorResponse, json, parseId } from "@/lib/api/http";
import { getServerEnv } from "@/lib/env";
import { refreshNotebookOverview } from "@/lib/notebooks/overview";
import { enforceRateLimit } from "@/lib/usage";

export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

/** Regenerates the notebook summary and suggested questions. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const notebookId = parseId((await params).id, "Notebook");
    const { supabase, user } = await requireUser();
    await requireNotebook(supabase, notebookId);
    await enforceRateLimit(supabase, user.id, "generation", getServerEnv().RATE_LIMIT_GENERATION_PER_HOUR, 3600);
    const { llm } = getAIProviders();
    await refreshNotebookOverview(supabase, user.id, notebookId, llm);
    const { data } = await supabase.from("notebooks").select("summary, suggested_questions").eq("id", notebookId).single();
    return json(data);
  } catch (error) {
    return errorResponse(error, "notebook.overview");
  }
}
