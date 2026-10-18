import { describe, expect, it } from "vitest";
import { MAX_DOCUMENTS, MAX_DOCUMENT_BYTES } from "@/config/documents";
import { checkUpload, cleanFileName, sniffType } from "./validate";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([1, 2, 3, 4]),
  Buffer.from("WEBPVP8 "),
]);
const HTML = Buffer.from("<html><script>alert(1)</script></html>");

const file = (name: string, type: string, bytes: Buffer) => ({ name, type, size: bytes.length });

describe("document uploads (spec step 68)", () => {
  it("knows each allowed type by its first bytes", () => {
    expect(sniffType(PDF)).toBe("application/pdf");
    expect(sniffType(JPEG)).toBe("image/jpeg");
    expect(sniffType(PNG)).toBe("image/png");
    expect(sniffType(WEBP)).toBe("image/webp");
    expect(sniffType(HTML)).toBeNull();
    expect(sniffType(Buffer.from("RIFF1234WAVE"))).toBeNull();
    expect(sniffType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it("keeps a file whose stated type matches its bytes", () => {
    expect(checkUpload(file("policy.pdf", "application/pdf", PDF), PDF, 0)).toEqual({
      ok: true,
      contentType: "application/pdf",
      fileName: "policy.pdf",
    });
    expect(checkUpload(file("r.jpg", "image/jpg", JPEG), JPEG, 0)).toMatchObject({
      ok: true,
      contentType: "image/jpeg",
    });
    expect(checkUpload(file("r.webp", "image/webp", WEBP), WEBP, 0)).toMatchObject({ ok: true });
  });

  it("refuses other types, and files that claim to be something they're not", () => {
    for (const [stated, bytes] of [
      ["text/html", HTML],
      ["application/pdf", HTML],
      ["image/png", PDF],
      ["image/svg+xml", Buffer.from("<svg/>")],
      ["", PDF],
    ] as const) {
      const result = checkUpload(file("x", stated, bytes), bytes, 0);
      expect(result, stated).toEqual({ ok: false, error: "Upload a PDF, JPEG, PNG or WebP file." });
    }
  });

  it("refuses empty and oversized files", () => {
    expect(
      checkUpload(file("e.pdf", "application/pdf", Buffer.alloc(0)), Buffer.alloc(0), 0),
    ).toEqual({ ok: false, error: "That file is empty." });
    const big = Buffer.concat([PDF, Buffer.alloc(MAX_DOCUMENT_BYTES)]);
    const result = checkUpload(file("big.pdf", "application/pdf", big), big, 0);
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toContain("larger than 4 MB");
  });

  it("stops at the per-person limit", () => {
    const at = checkUpload(file("p.pdf", "application/pdf", PDF), PDF, MAX_DOCUMENTS);
    expect(at).toEqual({
      ok: false,
      error: `You can keep up to ${MAX_DOCUMENTS} files. Delete one to add another.`,
    });
    expect(checkUpload(file("p.pdf", "application/pdf", PDF), PDF, MAX_DOCUMENTS - 1).ok).toBe(
      true,
    );
  });

  it("cleans file names for showing and for download headers", () => {
    expect(cleanFileName("C:\\Users\\me\\Policy 2027.pdf", "application/pdf")).toBe(
      "Policy 2027.pdf",
    );
    expect(cleanFileName('../../etc/"evil"\n.pdf', "application/pdf")).toBe("evil.pdf");
    expect(cleanFileName("   ", "image/png")).toBe("document.png");
    expect(cleanFileName("a".repeat(500), "application/pdf")).toHaveLength(120);
  });
});
