import { describe, expect, it } from "vitest";
import {
  assertContentMatchesKind,
  assertFileSize,
  assertOwnedStoragePath,
  detectFileKind,
  sanitizeFileName,
  titleFromFileName,
  ValidationError,
} from "@/lib/ingestion/validation";
import { safeNextPath } from "@/lib/auth-redirect";

const USER = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";

describe("upload validation", () => {
  it("detects supported kinds from file names and mime types", () => {
    expect(detectFileKind("Report.PDF")).toBe("pdf");
    expect(detectFileKind("notes.docx")).toBe("docx");
    expect(detectFileKind("readme.markdown")).toBe("md");
    expect(detectFileKind("a.txt")).toBe("txt");
    expect(detectFileKind("noext", "application/pdf")).toBe("pdf");
  });

  it("rejects unsupported types", () => {
    expect(() => detectFileKind("malware.exe")).toThrow(ValidationError);
    expect(() => detectFileKind("sheet.xlsx")).toThrow(/Unsupported/);
  });

  it("enforces size limits", () => {
    expect(() => assertFileSize(0, 25)).toThrow(/empty/);
    expect(() => assertFileSize(26 * 1024 * 1024, 25)).toThrow(/25 MB/);
    expect(() => assertFileSize(1024, 25)).not.toThrow();
  });

  it("checks magic bytes so renamed files are rejected", () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
    expect(() => assertContentMatchesKind(exe, "pdf")).toThrow(/not a valid PDF/);
    expect(() => assertContentMatchesKind(exe, "docx")).toThrow(/not a valid DOCX/);
    expect(() => assertContentMatchesKind(new TextEncoder().encode("%PDF-1.7\n..."), "pdf")).not.toThrow();
    expect(() => assertContentMatchesKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "docx")).not.toThrow();
  });

  it("rejects binary or non-UTF-8 content declared as text", () => {
    expect(() => assertContentMatchesKind(new Uint8Array([0x41, 0x00, 0x42]), "txt")).toThrow(/binary/);
    expect(() => assertContentMatchesKind(new Uint8Array([0xc3, 0x28]), "txt")).toThrow(/UTF-8/);
    expect(() => assertContentMatchesKind(new TextEncoder().encode("héllo"), "md")).not.toThrow();
  });

  it("only accepts storage paths inside the caller's notebook folder", () => {
    expect(() => assertOwnedStoragePath(`${USER}/${NB}/abc-file.pdf`, USER, NB)).not.toThrow();
    expect(() => assertOwnedStoragePath(`other-user/${NB}/file.pdf`, USER, NB)).toThrow();
    expect(() => assertOwnedStoragePath(`${USER}/${NB}/../x/file.pdf`, USER, NB)).toThrow();
    expect(() => assertOwnedStoragePath(`${USER}/${NB}/nested/file.pdf`, USER, NB)).toThrow();
    expect(() => assertOwnedStoragePath(`${USER}/other-notebook/file.pdf`, USER, NB)).toThrow();
  });

  it("sanitizes file names and derives titles", () => {
    expect(sanitizeFileName("../../etc/pass wd?.pdf")).toBe("pass_wd_.pdf");
    expect(sanitizeFileName("C:\\Users\\me\\Report (final).docx")).toBe("Report_final_.docx");
    expect(titleFromFileName("my_research-paper.v2.pdf")).toBe("my research paper.v2");
  });
});

describe("safeNextPath", () => {
  it("allows only same-site relative paths", () => {
    expect(safeNextPath("/notebooks/1")).toBe("/notebooks/1");
    expect(safeNextPath("//evil.com")).toBe("/dashboard");
    expect(safeNextPath("https://evil.com")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.com")).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
  });
});
