import type { SupabaseClient } from "@supabase/supabase-js";
import type { LLMProvider } from "@/lib/ai/types";
import { generateNotebookOverview } from "@/lib/ingestion/summaries";
import { logger } from "@/lib/logger";
import { recordUsage } from "@/lib/usage";

/** Regenerates the notebook overview and suggested questions from its ready sources. */
export async function refreshNotebookOverview(supabase: SupabaseClient, userId: string, notebookId: string, llm: LLMProvider) {
  const { data: sources, error } = await supabase
    .from("sources")
    .select("title, summary, extracted_text")
    .eq("notebook_id", notebookId)
    .eq("status", "ready")
    .order("created_at")
    .limit(20);
  if (error) {
    logger.warn("overview.load_failed", { notebookId, error: error.message });
    return;
  }
  if (!sources || sources.length === 0) {
    await supabase.from("notebooks").update({ summary: null, suggested_questions: [] }).eq("id", notebookId);
    return;
  }
  try {
    const overview = await generateNotebookOverview(
      llm,
      sources.map((s) => ({
        title: s.title as string,
        summary: (s.summary as string | null) ?? null,
        excerpt: ((s.extracted_text as string | null) ?? "").slice(0, 3000),
      })),
    );
    await supabase
      .from("notebooks")
      .update({ summary: overview.summary, suggested_questions: overview.suggestedQuestions.slice(0, 3) })
      .eq("id", notebookId);
    await recordUsage(supabase, userId, { kind: "generation", notebookId, model: llm.fastModel, units: 1 });
  } catch (err) {
    logger.warn("overview.generate_failed", { notebookId, error: err instanceof Error ? err.message : String(err) });
  }
}
