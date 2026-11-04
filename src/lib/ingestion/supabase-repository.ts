import type { SupabaseClient } from "@supabase/supabase-js";
import { recordUsage } from "@/lib/usage";
import type { EmbeddedChunk, IngestionRepository, PipelineSource } from "./pipeline";

const INSERT_BATCH = 100;

export class SupabaseIngestionRepository implements IngestionRepository {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly userId: string,
  ) {}

  private async update(sourceId: string, patch: Record<string, unknown>) {
    const { error } = await this.supabase.from("sources").update(patch).eq("id", sourceId);
    if (error) throw new Error(`Could not update source: ${error.message}`);
  }

  async getSource(sourceId: string): Promise<PipelineSource | null> {
    const { data, error } = await this.supabase
      .from("sources")
      .select("id, notebook_id, user_id, title, kind, storage_path, url, extracted_text, attempts")
      .eq("id", sourceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as PipelineSource | null;
  }

  async markProcessing(sourceId: string) {
    const { data } = await this.supabase.from("sources").select("attempts").eq("id", sourceId).single();
    await this.update(sourceId, {
      status: "processing",
      error: null,
      attempts: ((data?.attempts as number) ?? 0) + 1,
      processing_started_at: new Date().toISOString(),
    });
  }

  async downloadFile(storagePath: string): Promise<Uint8Array> {
    const { data, error } = await this.supabase.storage.from("sources").download(storagePath);
    if (error || !data) throw new Error(`Could not read the uploaded file: ${error?.message ?? "missing"}`);
    return new Uint8Array(await data.arrayBuffer());
  }

  async saveExtraction(sourceId: string, data: Parameters<IngestionRepository["saveExtraction"]>[1]) {
    await this.update(sourceId, {
      extracted_text: data.text,
      page_offsets: data.pageOffsets,
      page_count: data.pageCount,
      word_count: data.wordCount,
      ...(data.title ? { title: data.title } : {}),
      ...(data.url ? { url: data.url } : {}),
    });
  }

  async replaceChunks(source: PipelineSource, chunks: EmbeddedChunk[]) {
    const { error: deleteError } = await this.supabase.from("document_chunks").delete().eq("source_id", source.id);
    if (deleteError) throw new Error(`Could not clear old chunks: ${deleteError.message}`);
    for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
      const rows = chunks.slice(i, i + INSERT_BATCH).map((c) => ({
        source_id: source.id,
        notebook_id: source.notebook_id,
        user_id: source.user_id,
        chunk_index: c.index,
        content: c.content,
        page_start: c.pageStart,
        page_end: c.pageEnd,
        char_start: c.charStart,
        char_end: c.charEnd,
        token_count: c.tokenCount,
        embedding: c.embedding ? JSON.stringify(c.embedding) : null,
      }));
      const { error } = await this.supabase.from("document_chunks").insert(rows);
      if (error) throw new Error(`Could not store chunks: ${error.message}`);
    }
  }

  async markReady(sourceId: string, data: { chunkCount: number; summary: string | null }) {
    await this.update(sourceId, { status: "ready", error: null, chunk_count: data.chunkCount, summary: data.summary });
  }

  async markFailed(sourceId: string, error: string) {
    await this.update(sourceId, { status: "failed", error: error.slice(0, 500) });
  }

  async recordUsage(record: Parameters<IngestionRepository["recordUsage"]>[0]) {
    await recordUsage(this.supabase, this.userId, {
      kind: record.kind,
      model: record.model,
      units: record.units,
      inputTokens: record.inputTokens,
      notebookId: record.notebookId,
    });
  }
}
