import { describe, expect, it } from "vitest";
import { sniffType } from "@/lib/documents/validate";
import { textPdf } from "./pdf";

// The declarations page kept on /documents after a switch (spec step 105).

describe("textPdf", () => {
  it("makes a PDF the documents page accepts, with every line and a valid xref", () => {
    const bytes = textPdf(["Lighthouse (demo) declarations", "Policy number: DEMO-1", "Café (x)"]);
    expect(sniffType(bytes)).toBe("application/pdf");
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("(Policy number: DEMO-1) Tj");
    // Not ASCII becomes "?", and brackets are escaped.
    expect(text).toContain("(Caf? \\(x\\)) Tj");
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    const firstObject = Number(/\n(\d{10}) 00000 n /.exec(text)![1]);
    expect(text.slice(firstObject, firstObject + 7)).toBe("1 0 obj");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });
});
