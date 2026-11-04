import { pageForOffset, type ExtractedDocument } from "./normalize";

export interface Chunk {
  index: number;
  content: string;
  charStart: number;
  charEnd: number;
  pageStart: number | null;
  pageEnd: number | null;
  tokenCount: number;
}

export interface ChunkOptions {
  /** Target maximum characters per chunk (~4 chars per token). */
  maxChars?: number;
  /** Characters of trailing context repeated at the start of the next chunk. */
  overlapChars?: number;
  /** Chunks shorter than this are merged into a neighbour when possible. */
  minChars?: number;
}

interface Span {
  start: number;
  end: number;
}

export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/** Splits [start, end) into spans at the last match of `pattern` before each limit. */
function splitSpan(text: string, span: Span, maxChars: number, pattern: RegExp): Span[] {
  const out: Span[] = [];
  let start = span.start;
  while (span.end - start > maxChars) {
    const window = text.slice(start, start + maxChars);
    let cut = -1;
    for (const m of window.matchAll(pattern)) {
      const pos = (m.index ?? 0) + m[0].length;
      if (pos > maxChars * 0.3) cut = pos;
    }
    if (cut <= 0) {
      // No natural boundary: break at the last whitespace, or hard-cut.
      const ws = window.lastIndexOf(" ");
      cut = ws > maxChars * 0.5 ? ws + 1 : maxChars;
    }
    out.push({ start, end: start + cut });
    start += cut;
  }
  if (span.end > start) out.push({ start, end: span.end });
  return out;
}

/** Paragraph spans, with oversized paragraphs split at sentence boundaries. */
function segment(text: string, maxChars: number): Span[] {
  const spans: Span[] = [];
  const paragraph = /\n{2,}/g;
  let last = 0;
  const push = (start: number, end: number) => {
    // Trim surrounding whitespace while keeping offsets exact.
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end > start) spans.push(...splitSpan(text, { start, end }, maxChars, /[.!?。！？]["')\]]?\s+/g));
  };
  for (const m of text.matchAll(paragraph)) {
    push(last, m.index ?? 0);
    last = (m.index ?? 0) + m[0].length;
  }
  push(last, text.length);
  return spans;
}

/**
 * Packs paragraph/sentence segments into overlapping chunks. Chunk content is
 * always an exact slice of the document text, so [charStart, charEnd) can be
 * highlighted in the source viewer and mapped back to page numbers.
 */
export function chunkDocument(doc: ExtractedDocument, options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? 1600;
  const overlapChars = Math.min(options.overlapChars ?? 240, Math.floor(maxChars / 3));
  const minChars = options.minChars ?? 200;
  const { text } = doc;
  const segments = segment(text, maxChars);
  if (segments.length === 0) return [];

  const ranges: Span[] = [];
  let i = 0;
  while (i < segments.length) {
    const start = segments[i].start;
    let end = segments[i].end;
    let j = i + 1;
    while (j < segments.length && segments[j].end - start <= maxChars) {
      end = segments[j].end;
      j++;
    }
    ranges.push({ start, end });
    if (j >= segments.length) break;
    // Step back over trailing segments to create overlap. The next chunk must
    // still reach segment j, otherwise it would duplicate this one and stall.
    let k = j;
    while (
      k - 1 > i &&
      end - segments[k - 1].start <= overlapChars &&
      segments[j].end - segments[k - 1].start <= maxChars
    ) {
      k--;
    }
    i = k;
  }

  // Merge a tiny trailing chunk into its predecessor when it still fits.
  if (ranges.length > 1) {
    const lastRange = ranges[ranges.length - 1];
    const prev = ranges[ranges.length - 2];
    if (lastRange.end - lastRange.start < minChars && lastRange.end - prev.start <= maxChars * 1.25) {
      prev.end = lastRange.end;
      ranges.pop();
    }
  }

  return ranges.map((r, index) => {
    const content = text.slice(r.start, r.end);
    return {
      index,
      content,
      charStart: r.start,
      charEnd: r.end,
      pageStart: pageForOffset(doc.pageOffsets, r.start, doc.pageCount),
      pageEnd: pageForOffset(doc.pageOffsets, Math.max(r.start, r.end - 1), doc.pageCount),
      tokenCount: estimateTokens(content),
    };
  });
}
