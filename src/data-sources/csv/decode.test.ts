import { describe, expect, it } from "vitest";
import { decodeStatement } from "./decode";

describe("decodeStatement", () => {
  it("reads UTF-8, dropping a byte-order mark", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Date,CAFÉ")]);
    expect(decodeStatement(bytes)).toBe("Date,CAFÉ");
  });

  it("reads a Windows-1252 (Latin-1) file instead of mangling it", () => {
    const bytes = Uint8Array.from(Buffer.from("CAF\xc9 M\xdcNCHEN,-4.50", "latin1"));
    expect(decodeStatement(bytes)).toBe("CAFÉ MÜNCHEN,-4.50");
  });

  it("reads UTF-16, as Excel's Unicode Text save writes it", () => {
    const le = new Uint8Array([0xff, 0xfe, ...Buffer.from("Date,CAFÉ", "utf16le")]);
    expect(decodeStatement(le)).toBe("Date,CAFÉ");
    const be = Buffer.from("Date,CAFÉ", "utf16le").swap16();
    expect(decodeStatement(new Uint8Array([0xfe, 0xff, ...be]))).toBe("Date,CAFÉ");
  });
});
