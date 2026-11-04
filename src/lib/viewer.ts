/** Pure helpers for the source viewer (block splitting, search, range overlay). */

export interface TextBlock {
  /** 1-based page number for paged documents; null for unpaged sections. */
  page: number | null;
  start: number;
  end: number;
}

/**
 * Splits a document into renderable blocks: one per page for paged documents,
 * otherwise ~sectionSize-character sections cut at paragraph boundaries.
 */
export function splitBlocks(text: string, pageOffsets: number[], pageCount: number, sectionSize = 6000): TextBlock[] {
  if (pageCount > 1 && pageOffsets.length > 1) {
    return pageOffsets.map((start, i) => ({ page: i + 1, start, end: i + 1 < pageOffsets.length ? pageOffsets[i + 1] : text.length }));
  }
  const blocks: TextBlock[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + sectionSize);
    if (end < text.length) {
      const para = text.lastIndexOf("\n\n", end);
      if (para > start + sectionSize / 2) end = para + 2;
    }
    blocks.push({ page: null, start, end });
    start = end;
  }
  return blocks.length ? blocks : [{ page: null, start: 0, end: 0 }];
}

export function findMatches(text: string, query: string, limit = 500): { start: number; end: number }[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const haystack = text.toLowerCase();
  const out: { start: number; end: number }[] = [];
  let i = haystack.indexOf(q);
  while (i !== -1 && out.length < limit) {
    out.push({ start: i, end: i + q.length });
    i = haystack.indexOf(q, i + q.length);
  }
  return out;
}

export interface OverlayRange {
  start: number;
  end: number;
  kind: "highlight" | "search";
  active?: boolean;
  id?: string;
}

export interface Segment {
  text: string;
  start: number;
  ranges: OverlayRange[];
}

/** Cuts [blockStart, blockEnd) into segments, each covered by the same set of ranges. */
export function segmentBlock(text: string, blockStart: number, blockEnd: number, ranges: OverlayRange[]): Segment[] {
  const relevant = ranges.filter((r) => r.end > blockStart && r.start < blockEnd);
  const cuts = new Set<number>([blockStart, blockEnd]);
  for (const r of relevant) {
    cuts.add(Math.max(blockStart, r.start));
    cuts.add(Math.min(blockEnd, r.end));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    if (b <= a) continue;
    segments.push({ text: text.slice(a, b), start: a, ranges: relevant.filter((r) => r.start <= a && r.end >= b) });
  }
  return segments;
}
