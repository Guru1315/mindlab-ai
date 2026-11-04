import type { SourceKind } from "@/lib/types";

export const FILE_KINDS = {
  pdf: { extensions: [".pdf"], mimeTypes: ["application/pdf"] },
  docx: {
    extensions: [".docx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  },
  txt: { extensions: [".txt"], mimeTypes: ["text/plain"] },
  md: { extensions: [".md", ".markdown"], mimeTypes: ["text/markdown", "text/x-markdown", "text/plain"] },
} as const satisfies Record<string, { extensions: string[]; mimeTypes: string[] }>;

export type FileKind = keyof typeof FILE_KINDS;

export const ACCEPTED_FILE_TYPES = Object.values(FILE_KINDS)
  .flatMap((k) => [...k.extensions, ...k.mimeTypes])
  .join(",");

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Determines the kind of an uploaded file from its name (and declared mime type). */
export function detectFileKind(fileName: string, mimeType?: string): FileKind {
  const lower = fileName.toLowerCase();
  for (const [kind, spec] of Object.entries(FILE_KINDS) as [FileKind, (typeof FILE_KINDS)[FileKind]][]) {
    if (spec.extensions.some((ext) => lower.endsWith(ext))) return kind;
  }
  if (mimeType) {
    for (const [kind, spec] of Object.entries(FILE_KINDS) as [FileKind, (typeof FILE_KINDS)[FileKind]][]) {
      if ((spec.mimeTypes as readonly string[]).includes(mimeType)) return kind;
    }
  }
  throw new ValidationError("Unsupported file type. Upload a PDF, DOCX, TXT or Markdown file.");
}

export function mimeTypeForKind(kind: FileKind): string {
  return FILE_KINDS[kind].mimeTypes[0];
}

export function assertFileSize(size: number, maxMb: number) {
  if (size <= 0) throw new ValidationError("The file is empty.");
  if (size > maxMb * 1024 * 1024) throw new ValidationError(`Files must be ${maxMb} MB or smaller.`);
}

/**
 * Verifies file contents match the claimed type (magic bytes), so a renamed
 * executable or archive is never handed to a parser as a "PDF".
 */
export function assertContentMatchesKind(bytes: Uint8Array, kind: SourceKind) {
  const startsWith = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (kind === "pdf") {
    // %PDF- may be preceded by a few junk bytes in the wild; search the first 1 KB.
    const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
    if (!head.includes("%PDF-")) throw new ValidationError("This file is not a valid PDF.");
    return;
  }
  if (kind === "docx") {
    if (!startsWith([0x50, 0x4b, 0x03, 0x04])) throw new ValidationError("This file is not a valid DOCX document.");
    return;
  }
  if (kind === "txt" || kind === "md") {
    const sample = bytes.subarray(0, 8192);
    if (sample.includes(0)) throw new ValidationError("This file appears to be binary, not text.");
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(sample.length < bytes.length ? trimPartialUtf8(sample) : sample);
    } catch {
      throw new ValidationError("Text files must be UTF-8 encoded.");
    }
  }
}

/** Drops a trailing, incomplete UTF-8 sequence from a sample cut mid-character. */
function trimPartialUtf8(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const b = bytes[end - i];
    if ((b & 0xc0) === 0x80) continue; // continuation byte
    if ((b & 0x80) !== 0) end -= i; // lead byte of a possibly incomplete sequence
    break;
  }
  return bytes.subarray(0, end);
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(-120);
  return cleaned || "file";
}

export function titleFromFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 200) || "Untitled source";
}

/** Storage paths are always "<userId>/<notebookId>/<file>"; anything else is rejected. */
export function assertOwnedStoragePath(path: string, userId: string, notebookId: string) {
  const prefix = `${userId}/${notebookId}/`;
  if (!path.startsWith(prefix) || path.includes("..") || path.slice(prefix.length).includes("/")) {
    throw new ValidationError("Invalid storage path.");
  }
}
