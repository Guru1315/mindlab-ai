import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmbeddingProvider } from "@/lib/ai/types";
import type { Citation, SourceKind } from "@/lib/types";

export interface MatchedChunk {
  id: string;
  source_id: string;
  chunk_index: number;
  content: string;
  page_start: number | null;
  page_end: number | null;
  char_start: number;
  char_end: number;
  /** Null for keyword-only results or chunks stored without an embedding. */
  similarity: number | null;
  rank_score: number;
}

export interface Retriever {
  retrieve(params: { notebookId: string; query: string; sourceIds: string[]; limit: number; signal?: AbortSignal }): Promise<Citation[]>;
}

/** Lower bound on cosine similarity for semantic-only hits to be considered relevant. */
export const MIN_SIMILARITY = 0.25;

export const EXCERPT_CHARS = 420;

export function toExcerpt(content: string, max = EXCERPT_CHARS): string {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max).replace(/\s+\S*$/, "")}…` : clean;
}

/**
 * Keeps a hybrid-search row when it is semantically close enough, matched in
 * both the vector and keyword lists (RRF score above one list's maximum), or
 * has no embedding at all (indexed without AI, so only keywords can find it).
 */
export function isRelevantMatch(row: Pick<MatchedChunk, "similarity" | "rank_score">): boolean {
  return row.similarity == null || row.similarity >= MIN_SIMILARITY || row.rank_score > 1 / 61 + 1e-9;
}

/**
 * Supabase retriever. With an embedding provider it runs hybrid search
 * (match_chunks); without one it runs keyword search (search_chunks_text).
 * Both RPCs are SECURITY INVOKER and run with the user's JWT, so they only see
 * the caller's rows, scoped to one notebook and the selected sources.
 */
export class SupabaseRetriever implements Retriever {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly embeddings?: EmbeddingProvider,
  ) {}

  async retrieve({ notebookId, query, sourceIds, limit, signal }: Parameters<Retriever["retrieve"]>[0]): Promise<Citation[]> {
    if (sourceIds.length === 0) return [];
    const { data, error } = this.embeddings
      ? await this.supabase.rpc("match_chunks", {
          p_notebook_id: notebookId,
          p_query_embedding: JSON.stringify(await this.embeddings.embedQuery(query, signal)),
          p_query_text: query.slice(0, 1000),
          p_source_ids: sourceIds,
          p_match_count: limit,
        })
      : await this.supabase.rpc("search_chunks_text", {
          p_notebook_id: notebookId,
          p_query_text: query.slice(0, 1000),
          p_source_ids: sourceIds,
          p_match_count: limit,
        });
    if (error) throw new Error(`Retrieval failed: ${error.message}`);
    const rows = ((data ?? []) as MatchedChunk[]).filter(isRelevantMatch);
    if (rows.length === 0) return [];

    const ids = [...new Set(rows.map((r) => r.source_id))];
    const { data: sources, error: sourceError } = await this.supabase
      .from("sources")
      .select("id, title, kind")
      .in("id", ids);
    if (sourceError) throw new Error(`Retrieval failed: ${sourceError.message}`);
    const byId = new Map((sources ?? []).map((s) => [s.id as string, s as { id: string; title: string; kind: SourceKind }]));

    return rows.map((r, i) => ({
      index: i + 1,
      chunkId: r.id,
      sourceId: r.source_id,
      sourceTitle: byId.get(r.source_id)?.title ?? "Source",
      sourceKind: byId.get(r.source_id)?.kind ?? "text",
      excerpt: r.content,
      pageStart: r.page_start,
      pageEnd: r.page_end,
      charStart: r.char_start,
      charEnd: r.char_end,
    }));
  }
}
