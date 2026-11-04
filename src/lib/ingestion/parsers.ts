import { ValidationError } from "./validation";
import { documentFromPages, documentFromText, type ExtractedDocument } from "./normalize";

/** Hard ceiling on extracted characters per source (~500k words). */
export const MAX_EXTRACTED_CHARS = 3_000_000;

function enforceLimit(doc: ExtractedDocument): ExtractedDocument {
  if (doc.text.trim().length === 0) {
    throw new ValidationError(
      "No readable text was found. Scanned PDFs (images of text) are not supported yet; try a text-based PDF.",
    );
  }
  if (doc.text.length > MAX_EXTRACTED_CHARS) {
    throw new ValidationError("This source is too long. Split it into smaller documents (max ~500,000 words).");
  }
  return doc;
}

export async function parsePdf(bytes: Uint8Array): Promise<ExtractedDocument> {
  // unpdf bundles a serverless build of pdf.js; text extraction never runs PDF scripts.
  const { getDocumentProxy, extractText } = await import("unpdf");
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password/i.test(message)) throw new ValidationError("Password-protected PDFs are not supported.");
    throw new ValidationError("This PDF could not be read. It may be corrupted.");
  }
  try {
    const { text } = await extractText(pdf, { mergePages: false });
    let title: string | undefined;
    try {
      const meta = await pdf.getMetadata();
      const info = meta.info as { Title?: unknown } | undefined;
      if (typeof info?.Title === "string" && info.Title.trim()) title = info.Title.trim();
    } catch {
      // Metadata is optional.
    }
    return enforceLimit(documentFromPages(text, title));
  } finally {
    await pdf.loadingTask.destroy();
  }
}

export async function parseDocx(bytes: Uint8Array): Promise<ExtractedDocument> {
  const mammoth = await import("mammoth");
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return enforceLimit(documentFromText(result.value));
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("This DOCX file could not be read. It may be corrupted.");
  }
}

export function parsePlainText(bytes: Uint8Array): ExtractedDocument {
  return enforceLimit(documentFromText(new TextDecoder("utf-8").decode(bytes)));
}

export function parseMarkdown(bytes: Uint8Array): ExtractedDocument {
  const raw = new TextDecoder("utf-8").decode(bytes);
  const heading = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return enforceLimit(documentFromText(raw, heading));
}

export function parsePastedText(text: string): ExtractedDocument {
  return enforceLimit(documentFromText(text));
}
