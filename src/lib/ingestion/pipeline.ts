import type { EmbeddingProvider, LLMProvider } from "@/lib/ai/types";
import type { SourceKind } from "@/lib/types";
import { chunkDocument, type Chunk } from "./chunker";
import { countWords, type ExtractedDocument } from "./normalize";
import { parseDocx, parseMarkdown, parsePastedText, parsePdf, parsePlainText } from "./parsers";
import { fetchUrlDocument } from "./url";
import { assertContentMatchesKind, assertFileSize, ValidationError } from "./validation";
import { summarizeSource } from "./summaries";

export interface PipelineSource {
  id: string;
  notebook_id: string;
  user_id: string;
  title: string;
  kind: SourceKind;
  storage_path: string | null;
  url: string | null;
  extracted_text: string | null;
}

export interface EmbeddedChunk extends Chunk {
  /** Null when no embedding provider is configured (keyword-search mode). */
  embedding: number[] | null;
}

/** Persistence operations the pipeline needs; implemented over Supabase in production. */
export interface IngestionRepository {
  getSource(sourceId: string): Promise<PipelineSource | null>;
  markProcessing(sourceId: string): Promise<void>;
  downloadFile(storagePath: string): Promise<Uint8Array>;
  saveExtraction(
    sourceId: string,
    data: { text: string; pageOffsets: number[]; pageCount: number; wordCount: number; title?: string; url?: string },
  ): Promise<void>;
  replaceChunks(source: PipelineSource, chunks: EmbeddedChunk[]): Promise<void>;
  markReady(sourceId: string, data: { chunkCount: number; summary: string | null }): Promise<void>;
  markFailed(sourceId: string, error: string): Promise<void>;
  recordUsage(record: { kind: "ingest" | "embedding"; model?: string; units: number; inputTokens?: number; notebookId: string }): Promise<void>;
}

export interface IngestionDeps {
  repo: IngestionRepository;
  /** Optional: without it, chunks are stored for keyword search only. */
  embeddings?: EmbeddingProvider;
  /** Optional: generates a short "source guide" summary. */
  llm?: LLMProvider;
  maxUploadMb: number;
  signal?: AbortSignal;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

const userFacingMessage = (error: unknown) =>
  error instanceof ValidationError || (error instanceof Error && error.name === "AIConfigurationError")
    ? error.message
    : "Processing failed due to a temporary error. Use Retry to try again.";

async function extract(source: PipelineSource, deps: IngestionDeps): Promise<{ doc: ExtractedDocument; url?: string }> {
  switch (source.kind) {
    case "pdf":
    case "docx":
    case "txt":
    case "md": {
      if (!source.storage_path) throw new ValidationError("The uploaded file is missing.");
      const bytes = await deps.repo.downloadFile(source.storage_path);
      assertFileSize(bytes.byteLength, deps.maxUploadMb);
      assertContentMatchesKind(bytes, source.kind);
      if (source.kind === "pdf") return { doc: await parsePdf(bytes) };
      if (source.kind === "docx") return { doc: await parseDocx(bytes) };
      if (source.kind === "md") return { doc: parseMarkdown(bytes) };
      return { doc: parsePlainText(bytes) };
    }
    case "url": {
      if (!source.url) throw new ValidationError("The source URL is missing.");
      const page = await fetchUrlDocument(source.url, { signal: deps.signal });
      return { doc: page.document, url: page.finalUrl };
    }
    case "text": {
      if (!source.extracted_text) throw new ValidationError("The pasted text is empty.");
      return { doc: parsePastedText(source.extracted_text) };
    }
  }
}

/**
 * Ingestion pipeline: extract -> normalize -> chunk (with page metadata) ->
 * embed -> store -> mark ready. Failures are recorded on the source row with a
 * user-facing message; the source can be retried.
 */
export async function processSource(sourceId: string, deps: IngestionDeps): Promise<{ status: "ready" | "failed"; chunkCount: number }> {
  const log = deps.log ?? (() => {});
  const source = await deps.repo.getSource(sourceId);
  if (!source) throw new Error(`Source ${sourceId} not found`);
  await deps.repo.markProcessing(sourceId);
  log("ingest.start", { sourceId, kind: source.kind });

  try {
    const { doc, url } = await extract(source, deps);
    const wordCount = countWords(doc.text);
    const betterTitle = doc.title && /^(untitled|https?:)/i.test(source.title) ? doc.title.slice(0, 200) : undefined;
    await deps.repo.saveExtraction(sourceId, {
      text: doc.text,
      pageOffsets: doc.pageOffsets,
      pageCount: doc.pageCount,
      wordCount,
      title: source.kind === "url" ? (doc.title?.slice(0, 200) ?? undefined) : betterTitle,
      url,
    });

    const chunks = chunkDocument(doc);
    if (chunks.length === 0) throw new ValidationError("No readable text was found in this source.");

    const title = (source.kind === "url" ? doc.title : undefined) ?? source.title;
    const vectors = deps.embeddings
      ? await deps.embeddings.embedDocuments(
          chunks.map((c) => ({ title, text: c.content })),
          deps.signal,
        )
      : null;
    await deps.repo.replaceChunks(
      source,
      chunks.map((c, i) => ({ ...c, embedding: vectors?.[i] ?? null })),
    );
    if (deps.embeddings) {
      await deps.repo.recordUsage({
        kind: "embedding",
        model: deps.embeddings.model,
        units: chunks.length,
        inputTokens: chunks.reduce((s, c) => s + c.tokenCount, 0),
        notebookId: source.notebook_id,
      });
    }

    let summary: string | null = null;
    if (deps.llm) {
      try {
        summary = await summarizeSource(deps.llm, title, doc.text, deps.signal);
      } catch (error) {
        log("ingest.summary_failed", { sourceId, error: String(error) });
      }
    }

    await deps.repo.markReady(sourceId, { chunkCount: chunks.length, summary });
    await deps.repo.recordUsage({ kind: "ingest", units: wordCount, notebookId: source.notebook_id });
    log("ingest.ready", { sourceId, chunks: chunks.length, words: wordCount });
    return { status: "ready", chunkCount: chunks.length };
  } catch (error) {
    log("ingest.failed", { sourceId, error: error instanceof Error ? error.message : String(error) });
    await deps.repo.markFailed(sourceId, userFacingMessage(error));
    return { status: "failed", chunkCount: 0 };
  }
}
