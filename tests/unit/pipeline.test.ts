import { describe, expect, it } from "vitest";
import { processSource, type EmbeddedChunk, type IngestionRepository, type PipelineSource } from "@/lib/ingestion/pipeline";
import { buildPdf } from "../fixtures/pdf";
import { FakeEmbeddings, FakeLLM } from "../fakes";

class MemoryRepo implements IngestionRepository {
  sources = new Map<string, PipelineSource & Record<string, unknown>>();
  files = new Map<string, Uint8Array>();
  chunks = new Map<string, EmbeddedChunk[]>();
  statuses: string[] = [];
  usage: { kind: string; units: number }[] = [];

  async getSource(id: string) {
    return this.sources.get(id) ?? null;
  }
  async markProcessing(id: string) {
    this.statuses.push("processing");
    Object.assign(this.sources.get(id)!, { status: "processing" });
  }
  async downloadFile(path: string) {
    const f = this.files.get(path);
    if (!f) throw new Error("missing");
    return f;
  }
  async saveExtraction(id: string, data: Record<string, unknown>) {
    Object.assign(this.sources.get(id)!, { extraction: data, ...(data.title ? { title: data.title } : {}) });
  }
  async replaceChunks(source: PipelineSource, chunks: EmbeddedChunk[]) {
    this.chunks.set(source.id, chunks);
  }
  async markReady(id: string, data: { chunkCount: number; summary: string | null }) {
    this.statuses.push("ready");
    Object.assign(this.sources.get(id)!, { status: "ready", ...data });
  }
  async markFailed(id: string, error: string) {
    this.statuses.push("failed");
    Object.assign(this.sources.get(id)!, { status: "failed", error });
  }
  async recordUsage(r: { kind: string; units: number }) {
    this.usage.push(r);
  }
}

const base = { notebook_id: "nb", user_id: "u", url: null, extracted_text: null, storage_path: null };

describe("processSource", () => {
  it("ingests a PDF: extract → chunk with pages → embed → store → ready", async () => {
    const repo = new MemoryRepo();
    repo.files.set("u/nb/doc.pdf", buildPdf([["Mitochondria produce ATP through respiration."], ["Ribosomes synthesize proteins from mRNA."]]));
    repo.sources.set("s1", { ...base, id: "s1", title: "Cell biology", kind: "pdf", storage_path: "u/nb/doc.pdf" });
    const embeddings = new FakeEmbeddings();
    const llm = new FakeLLM({ text: () => "A short summary.\nKey topics: cells" });

    const result = await processSource("s1", { repo, embeddings, llm, maxUploadMb: 25 });

    expect(result.status).toBe("ready");
    expect(repo.statuses).toEqual(["processing", "ready"]);
    const chunks = repo.chunks.get("s1")!;
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].embedding).toHaveLength(768);
    expect(chunks[0].pageStart).toBe(1);
    expect(chunks.at(-1)!.pageEnd).toBe(2);
    expect(embeddings.documentCalls[0][0].title).toBe("Cell biology");
    const source = repo.sources.get("s1")!;
    expect(source.summary).toContain("short summary");
    expect((source.extraction as { pageCount: number }).pageCount).toBe(2);
    expect(repo.usage.map((u) => u.kind)).toEqual(["embedding", "ingest"]);
  });

  it("ingests pasted text without an LLM", async () => {
    const repo = new MemoryRepo();
    repo.sources.set("s2", { ...base, id: "s2", title: "Notes", kind: "text", extracted_text: "Entropy measures disorder.\n\nIt always increases in isolated systems." });
    const result = await processSource("s2", { repo, embeddings: new FakeEmbeddings(), maxUploadMb: 25 });
    expect(result).toEqual({ status: "ready", chunkCount: 1 });
    expect(repo.sources.get("s2")!.summary).toBeNull();
  });

  it("marks the source failed with a user-facing message for invalid content", async () => {
    const repo = new MemoryRepo();
    repo.files.set("u/nb/fake.pdf", new TextEncoder().encode("MZ this is an exe"));
    repo.sources.set("s3", { ...base, id: "s3", title: "Fake", kind: "pdf", storage_path: "u/nb/fake.pdf" });
    const result = await processSource("s3", { repo, embeddings: new FakeEmbeddings(), maxUploadMb: 25 });
    expect(result.status).toBe("failed");
    expect(repo.sources.get("s3")!.error).toBe("This file is not a valid PDF.");
    expect(repo.chunks.has("s3")).toBe(false);
  });

  it("hides internal errors behind a retryable message", async () => {
    const repo = new MemoryRepo();
    repo.sources.set("s4", { ...base, id: "s4", title: "Notes", kind: "text", extracted_text: "Some text here." });
    const broken = new FakeEmbeddings();
    broken.embedDocuments = async () => {
      throw new Error("503 upstream secret detail");
    };
    const result = await processSource("s4", { repo, embeddings: broken, maxUploadMb: 25 });
    expect(result.status).toBe("failed");
    expect(repo.sources.get("s4")!.error).toMatch(/Retry/);
    expect(repo.sources.get("s4")!.error).not.toContain("secret");
  });

  it("indexes sources for keyword search when no AI provider is configured", async () => {
    const repo = new MemoryRepo();
    repo.files.set("u/nb/doc.pdf", buildPdf([["Mitochondria produce ATP."], ["Ribosomes make proteins."]]));
    repo.sources.set("s6", { ...base, id: "s6", title: "Cells", kind: "pdf", storage_path: "u/nb/doc.pdf" });
    const result = await processSource("s6", { repo, maxUploadMb: 25 });
    expect(result.status).toBe("ready");
    const chunks = repo.chunks.get("s6")!;
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.embedding === null)).toBe(true);
    expect(chunks.at(-1)!.pageEnd).toBe(2);
    expect(repo.sources.get("s6")!.summary).toBeNull();
    expect(repo.usage.map((u) => u.kind)).toEqual(["ingest"]);
  });

  it("surfaces AI configuration problems to the user instead of a generic error", async () => {
    const repo = new MemoryRepo();
    repo.sources.set("s7", { ...base, id: "s7", title: "Notes", kind: "text", extracted_text: "Some text." });
    const blocked = new FakeEmbeddings();
    blocked.embedDocuments = async () => {
      const error = new Error("Vercel AI Gateway is not enabled for this team yet: add a credit card.");
      error.name = "AIConfigurationError";
      throw error;
    };
    await processSource("s7", { repo, embeddings: blocked, maxUploadMb: 25 });
    expect(repo.sources.get("s7")!.error).toMatch(/AI Gateway is not enabled/);
  });

  it("still succeeds when the optional summary fails", async () => {
    const repo = new MemoryRepo();
    repo.sources.set("s5", { ...base, id: "s5", title: "Notes", kind: "text", extracted_text: "Valid content for embedding." });
    const llm = new FakeLLM();
    llm.generateText = async () => {
      throw new Error("model down");
    };
    const result = await processSource("s5", { repo, embeddings: new FakeEmbeddings(), llm, maxUploadMb: 25 });
    expect(result.status).toBe("ready");
  });
});
