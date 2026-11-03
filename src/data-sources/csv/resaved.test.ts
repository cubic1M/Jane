import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readCsvFile } from "./csv-source";

// Opened in Excel and saved again, a statement's dates come back the way the computer writes them,
// whatever the bank wrote (night QA 11-03: a USAA file's 196 rows all "Unreadable date", on a
// date anyone can read). Every US bank's file has to survive that.
const DIR = new URL("./__fixtures__/", import.meta.url);
// The layouts Jane knows, which read dates one way: a file it doesn't know goes to the column
// picker, which works out the dates' order from the file (column-mapping.test.ts).
const FILES = readdirSync(DIR).filter(
  (f) =>
    f.endsWith(".csv") && readCsvFile({ name: f, text: readFileSync(new URL(f, DIR), "utf8") }).ok,
);

const iso = /\b(20\d\d)-(\d\d)-(\d\d)\b/g;
const us = /\b(\d\d)\/(\d\d)\/(20\d\d)\b/g;
const resaved = {
  "10/24/2026": (text: string) =>
    text
      .replace(iso, (_, y, m, d) => `${Number(m)}/${Number(d)}/${y}`)
      .replace(us, (_, m, d, y) => `${Number(m)}/${Number(d)}/${y}`),
  "10/24/26": (text: string) =>
    text
      .replace(iso, (_, y, m, d) => `${Number(m)}/${Number(d)}/${y.slice(2)}`)
      .replace(us, (_, m, d, y) => `${Number(m)}/${Number(d)}/${y.slice(2)}`),
};

function rowsOf(name: string, text: string) {
  const result = readCsvFile({ name, text });
  if (!result.ok) throw new Error(`${name}: ${result.error}`);
  return result.transactions.map((r) => [r.date, r.amountCents]);
}

describe("a statement opened in Excel and saved again", () => {
  it("has files to check", () => {
    expect(FILES.length).toBeGreaterThan(15);
  });

  for (const [written, change] of Object.entries(resaved)) {
    it.each(FILES)(`keeps every row of %s with dates like ${written}`, (name) => {
      const text = readFileSync(new URL(name, DIR), "utf8");
      const before = rowsOf(name, text);
      expect(before.length).toBeGreaterThan(0);
      expect(rowsOf(name, change(text))).toEqual(before);
    });
  }
});
