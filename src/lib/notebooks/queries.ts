import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotebookWithCounts } from "@/lib/types";

/** Escapes characters with special meaning in PostgREST ilike filters. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_,()]/g, (c) => `\\${c}`);
}

export async function listNotebooks(
  supabase: SupabaseClient,
  options: { query?: string; archived?: boolean; limit?: number } = {},
): Promise<NotebookWithCounts[]> {
  let q = supabase
    .from("notebooks")
    .select("*, sources(count)")
    .eq("is_archived", options.archived ?? false)
    .order("last_opened_at", { ascending: false })
    .limit(options.limit ?? 200);
  const term = options.query?.trim();
  if (term) {
    const like = `%${escapeLike(term.slice(0, 100))}%`;
    q = q.or(`title.ilike.${like},description.ilike.${like}`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const { sources, ...rest } = row as Record<string, unknown> & { sources?: { count: number }[] };
    return { ...(rest as unknown as NotebookWithCounts), source_count: sources?.[0]?.count ?? 0 };
  });
}

export async function recentSources(supabase: SupabaseClient, limit = 6) {
  const { data, error } = await supabase
    .from("sources")
    .select("id, title, kind, status, notebook_id, updated_at, notebooks!inner(title, emoji, is_archived)")
    .eq("notebooks.is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as {
    id: string;
    title: string;
    kind: string;
    status: string;
    notebook_id: string;
    updated_at: string;
    notebooks: { title: string; emoji: string };
  }[];
}
