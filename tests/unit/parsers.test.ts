import { Document, Packer, Paragraph, TextRun } from "docx";
import { describe, expect, it } from "vitest";
import { parseDocx, parseMarkdown, parsePastedText, parsePdf, parsePlainText } from "@/lib/ingestion/parsers";
import { ValidationError } from "@/lib/ingestion/validation";
import { buildPdf } from "../fixtures/pdf";

describe("parsePdf (real pdf.js)", () => {
  it("extracts text per page and records page offsets", async () => {
    const pdf = buildPdf([
      ["Photosynthesis overview", "Plants convert light into chemical energy."],
      ["The Calvin cycle", "Carbon fixation happens in the stroma."],
    ]);
    const doc = await parsePdf(pdf);
    expect(doc.pageCount).toBe(2);
    expect(doc.pageOffsets).toHaveLength(2);
    expect(doc.text).toContain("Plants convert light into chemical energy.");
    const page2 = doc.text.slice(doc.pageOffsets[1]);
    expect(page2).toContain("Calvin cycle");
    expect(page2).not.toContain("Photosynthesis overview");
  });

  it("rejects corrupted PDFs with a clear message", async () => {
    await expect(parsePdf(new TextEncoder().encode("%PDF-1.4 garbage"))).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects PDFs without a text layer", async () => {
    await expect(parsePdf(buildPdf([[]]))).rejects.toThrow(/No readable text/);
  });
});

describe("parseDocx (real mammoth)", () => {
  it("extracts paragraphs from a Word document", async () => {
    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun({ text: "Quarterly report", bold: true })] }),
            new Paragraph("Revenue grew 12 percent year over year."),
            new Paragraph("Costs were flat."),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(document);
    const doc = await parseDocx(new Uint8Array(buffer));
    expect(doc.text).toContain("Quarterly report");
    expect(doc.text).toContain("Revenue grew 12 percent year over year.");
    expect(doc.pageCount).toBe(1);
  });

  it("rejects invalid DOCX archives", async () => {
    await expect(parseDocx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("text and markdown", () => {
  it("parses UTF-8 text", () => {
    const doc = parsePlainText(new TextEncoder().encode("Café  notes\r\n\r\nSecond line"));
    expect(doc.text).toBe("Café notes\n\nSecond line");
  });

  it("uses the first Markdown heading as the title", () => {
    const doc = parseMarkdown(new TextEncoder().encode("# Lecture 4: Entropy\n\nEntropy measures disorder."));
    expect(doc.title).toBe("Lecture 4: Entropy");
    expect(doc.text).toContain("Entropy measures disorder.");
  });

  it("rejects empty pasted text", () => {
    expect(() => parsePastedText("   \n  ")).toThrow(ValidationError);
  });
});
