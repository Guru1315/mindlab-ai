import type { SupabaseClient } from "@supabase/supabase-js";
import { wrapUntrusted } from "./prompt";

export interface SourceMaterial {
  id: string;
  title: string;
  text: string;
}

/**
 * Builds whole-notebook context for Studio tools and audio scripts, where the
 * model needs broad coverage rather than a few retrieved passages. When the
 * selected sources exceed the budget, each source gets a proportional share,
 * sampled evenly across its chunks so the beginning, middle and end are all
 * represented.
 */
export function buildSourceContext(sources: SourceMaterial[], budgetChars = 400_000): string {
  if (sources.length === 0) return "";
  const total = sources.reduce((s, x) => s + x.text.length, 0);
  const blocks = sources.map((source) => {
    const share = total <= budgetChars ? source.text.length : Math.floor((source.text.length / total) * budgetChars);
    return wrapUntrusted("source", sampleEvenly(source.text, Math.max(share, 2000)), { title: source.title });
  });
  return blocks.join("\n\n");
}

export function sampleEvenly(text: string, maxChars: number, windows = 12): string {
  if (text.length <= maxChars) return text;
  const windowSize = Math.floor(maxChars / windows);
  const parts: string[] = [];
  for (let i = 0; i < windows; i++) {
    // Spread window starts so the first begins at 0 and the last ends exactly at the end.
    const start = Math.round((i * (text.length - windowSize)) / (windows - 1));
    parts.push(text.slice(start, start + windowSize));
  }
  return parts.join("\n[…]\n");
}

/** Loads extracted text for the selected, processed sources of a notebook (RLS-scoped). */
export async function loadSourceMaterial(
  supabase: SupabaseClient,
  notebookId: string,
  sourceIds: string[],
): Promise<SourceMaterial[]> {
  if (sourceIds.length === 0) return [];
  const { data, error } = await supabase
    .from("sources")
    .select("id, title, extracted_text")
    .eq("notebook_id", notebookId)
    .eq("status", "ready")
    .in("id", sourceIds)
    .order("created_at");
  if (error) throw new Error(`Could not load sources: ${error.message}`);
  return (data ?? [])
    .filter((s) => typeof s.extracted_text === "string" && s.extracted_text.length > 0)
    .map((s) => ({ id: s.id as string, title: s.title as string, text: s.extracted_text as string }));
}
