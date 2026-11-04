import type { Citation } from "@/lib/types";

const MARKER = /\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g;

/** Expands "1, 3-5" into [1, 3, 4, 5]. */
function expand(group: string): number[] {
  const out: number[] = [];
  for (const part of group.split(/\s*,\s*/)) {
    const range = part.match(/^(\d+)\s*[–-]\s*(\d+)$/);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      if (b >= a && b - a <= 20) for (let n = a; n <= b; n++) out.push(n);
    } else if (/^\d+$/.test(part)) {
      out.push(Number(part));
    }
  }
  return out;
}

export interface CitationResolution {
  /** Answer text with invalid markers removed and groups normalized to [1][2]. */
  text: string;
  /** Citations actually referenced by valid markers, in first-use order. */
  citations: Citation[];
  /** Marker numbers that did not correspond to any provided passage. */
  invalid: number[];
}

/**
 * Validates the model's citation markers against the passages that were
 * actually supplied. Unknown numbers are stripped rather than shown, so the UI
 * can never display a citation that does not point at real retrieved text.
 */
export function resolveCitations(answer: string, available: Citation[]): CitationResolution {
  const byIndex = new Map(available.map((c) => [c.index, c]));
  const used = new Map<number, Citation>();
  const invalid = new Set<number>();

  const text = answer
    .replace(MARKER, (_match, group: string) => {
      const valid: number[] = [];
      for (const n of expand(group)) {
        const citation = byIndex.get(n);
        if (citation) {
          valid.push(n);
          if (!used.has(n)) used.set(n, citation);
        } else {
          invalid.add(n);
        }
      }
      return [...new Set(valid)].map((n) => `[${n}]`).join("");
    })
    // Tidy whitespace left behind by removed markers.
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");

  return { text, citations: [...used.values()], invalid: [...invalid] };
}

/** Splits text into plain segments and citation numbers, for rendering chips. */
export function splitCitationMarkers(text: string): (string | number)[] {
  const parts: (string | number)[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKER)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(...expand(m[1]));
    last = start + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
