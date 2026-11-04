import { describe, expect, it } from "vitest";
import { chunkDocument } from "@/lib/ingestion/chunker";
import { countWords, documentFromPages, documentFromText, normalizeText, pageForOffset } from "@/lib/ingestion/normalize";

const paragraph = (n: number) =>
  `Paragraph ${n} discusses topic ${n} in detail. It contains several sentences. Each sentence adds a little more information about item ${n}. The final sentence wraps up paragraph ${n}.`;

describe("normalizeText", () => {
  it("normalizes whitespace, control characters and hyphenation", () => {
    const raw = "Hello\u0000  world\r\n\r\n\r\n\r\nThis is infor-\nmation. Done﻿";
    expect(normalizeText(raw)).toBe("Hello world\n\nThis is information. Done");
  });

  it("counts words across scripts", () => {
    expect(countWords("Hello, world! It's 2026 — naïve café.")).toBe(6);
  });
});

describe("page mapping", () => {
  it("records page offsets and maps offsets back to pages", () => {
    const doc = documentFromPages(["First page text.", "Second page text.", "Third."]);
    expect(doc.pageCount).toBe(3);
    expect(doc.text.slice(doc.pageOffsets[1]).startsWith("Second page")).toBe(true);
    expect(pageForOffset(doc.pageOffsets, 0, doc.pageCount)).toBe(1);
    expect(pageForOffset(doc.pageOffsets, doc.pageOffsets[1] + 3, doc.pageCount)).toBe(2);
    expect(pageForOffset(doc.pageOffsets, doc.text.length - 1, doc.pageCount)).toBe(3);
  });

  it("returns null pages for unpaged documents", () => {
    const doc = documentFromText("Just text");
    expect(pageForOffset(doc.pageOffsets, 3, doc.pageCount)).toBeNull();
  });
});

describe("chunkDocument", () => {
  const doc = documentFromText(Array.from({ length: 40 }, (_, i) => paragraph(i + 1)).join("\n\n"));

  it("produces chunks that are exact slices of the document", () => {
    const chunks = chunkDocument(doc, { maxChars: 800, overlapChars: 150 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) {
      expect(doc.text.slice(c.charStart, c.charEnd)).toBe(c.content);
      expect(c.content.length).toBeLessThanOrEqual(800 * 1.25);
      expect(c.tokenCount).toBe(Math.ceil(c.content.length / 4));
    }
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("covers the entire document and overlaps neighbours", () => {
    const chunks = chunkDocument(doc, { maxChars: 800, overlapChars: 300 });
    expect(chunks[0].charStart).toBe(0);
    expect(chunks.at(-1)!.charEnd).toBe(doc.text.length);
    for (let i = 1; i < chunks.length; i++) {
      // No gaps: each chunk starts at or before the previous one ends.
      expect(chunks[i].charStart).toBeLessThanOrEqual(chunks[i - 1].charEnd + 2);
      expect(chunks[i].charStart).toBeGreaterThan(chunks[i - 1].charStart);
    }
    const overlapping = chunks.slice(1).filter((c, i) => c.charStart < chunks[i].charEnd);
    expect(overlapping.length).toBeGreaterThan(0);
  });

  it("splits a single huge paragraph without whitespace boundaries", () => {
    const huge = documentFromText("x".repeat(5000));
    const chunks = chunkDocument(huge, { maxChars: 1000, overlapChars: 0 });
    expect(chunks.length).toBe(5);
    expect(chunks.map((c) => c.content).join("")).toBe(huge.text);
  });

  it("terminates when segments are larger than the overlap window", () => {
    const sentences = Array.from({ length: 30 }, (_, i) => `Sentence ${i} ${"word ".repeat(60)}.`).join(" ");
    const chunks = chunkDocument(documentFromText(sentences), { maxChars: 700, overlapChars: 200 });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.length).toBeLessThan(200);
  });

  it("assigns page ranges from page offsets", () => {
    const paged = documentFromPages(Array.from({ length: 6 }, (_, p) => Array.from({ length: 4 }, (_, i) => paragraph(p * 10 + i)).join("\n\n")));
    const chunks = chunkDocument(paged, { maxChars: 600, overlapChars: 100 });
    expect(chunks[0].pageStart).toBe(1);
    expect(chunks.at(-1)!.pageEnd).toBe(6);
    for (const c of chunks) {
      expect(c.pageStart).toBe(pageForOffset(paged.pageOffsets, c.charStart, paged.pageCount));
      expect(c.pageEnd! >= c.pageStart!).toBe(true);
    }
  });

  it("returns no chunks for empty text", () => {
    expect(chunkDocument(documentFromText("   "))).toEqual([]);
  });
});
