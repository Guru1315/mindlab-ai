/**
 * Text normalization applied to every extracted document before chunking.
 * Offsets stored on chunks refer to the normalized text, which is also what
 * the source viewer renders, so citations highlight the exact passage.
 */
// Built from char codes so the source stays free of invisible characters.
const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0xa0);
const CONTROL_CHARS = new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F" + BOM + "]", "g");

export function normalizeText(input: string): string {
  return (
    input
      .normalize("NFC")
      .replace(/\r\n?/g, "\n")
      // Strip control characters except tab and newline.
      .replace(CONTROL_CHARS, "")
      .split(NBSP)
      .join(" ")
      // Join words hyphenated across line breaks ("infor-\nmation").
      .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return matches ? matches.length : 0;
}

export interface ExtractedDocument {
  text: string;
  /** Start offset of each page in `text` (one entry per page; [0] for unpaged documents). */
  pageOffsets: number[];
  pageCount: number;
  title?: string;
}

/** Joins per-page texts into one document, recording where each page starts. */
export function documentFromPages(pages: string[], title?: string): ExtractedDocument {
  const pageOffsets: number[] = [];
  let text = "";
  for (const raw of pages) {
    const page = normalizeText(raw);
    if (text.length > 0) text += "\n\n";
    pageOffsets.push(text.length);
    text += page;
  }
  return { text, pageOffsets: pageOffsets.length ? pageOffsets : [0], pageCount: Math.max(pages.length, 1), title };
}

export function documentFromText(raw: string, title?: string): ExtractedDocument {
  return { text: normalizeText(raw), pageOffsets: [0], pageCount: 1, title };
}

/** 1-based page number containing `offset`, or null for unpaged documents. */
export function pageForOffset(pageOffsets: number[], offset: number, pageCount: number): number | null {
  if (pageCount <= 1 && pageOffsets.length <= 1) return null;
  let lo = 0;
  let hi = pageOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pageOffsets[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
