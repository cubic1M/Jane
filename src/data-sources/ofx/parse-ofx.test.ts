import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { looksLikeOfx, readOfx } from "./parse-ofx";

const fixture = (name: string) => ({
  name,
  text: readFileSync(join(__dirname, "__fixtures__", name), "utf8"),
});

describe("readOfx", () => {
  it("reads an OFX 1.x (SGML) checking statement", () => {
    const result = readOfx(fixture("checking-sgml.ofx"));
    if (!result.ok) throw new Error(result.error);

    expect(result.transactions).toEqual([
      expect.objectContaining({
        date: "2026-10-01",
        amountCents: 1549,
        description: "NETFLIX.COM Recurring payment",
        merchantName: "Netflix",
        externalId: "ofx:202610010001",
        hints: { bankType: "DEBIT" },
      }),
      expect.objectContaining({
        date: "2026-10-03",
        amountCents: -250_000,
        externalId: "ofx:202610030002",
      }),
      expect.objectContaining({
        date: "2026-10-04",
        amountCents: 3500,
        description: "OVERDRAFT FEE",
      }),
    ]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: "Missing or unreadable date (DTPOSTED)" }),
    ]);
  });

  it("reads an OFX 2.x (XML) card statement, decoding entities", () => {
    const result = readOfx(fixture("card-xml.qfx"));
    if (!result.ok) throw new Error(result.error);
    expect(
      result.transactions.map((t) => [t.date, t.amountCents, t.description, t.externalId]),
    ).toEqual([
      ["2026-10-02", 4999, "GADGET SHOP & CO", "ofx:2026100200A1"],
      ["2026-10-08", -12_000, "PAYMENT THANK YOU", "ofx:2026100800B2"],
    ]);
  });

  it("refuses files that aren't OFX", () => {
    expect(readOfx({ name: "x.ofx", text: "Date,Amount\n" })).toMatchObject({ ok: false });
    expect(readOfx({ name: "x.ofx", text: "<OFX></OFX>" })).toMatchObject({
      ok: false,
      error: "The file has no transactions.",
    });
  });

  it("recognizes OFX by name or by its header", () => {
    expect(looksLikeOfx("statement.QFX", "")).toBe(true);
    expect(looksLikeOfx("download", "OFXHEADER:100\nDATA:OFXSGML")).toBe(true);
    expect(looksLikeOfx("download", '<?xml version="1.0"?>\n<?OFX OFXHEADER="200"?>')).toBe(true);
    expect(looksLikeOfx("export.csv", "Date,Amount")).toBe(false);
  });
});
