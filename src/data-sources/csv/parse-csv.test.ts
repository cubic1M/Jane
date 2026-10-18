import { describe, expect, it } from "vitest";
import { parseCsv } from "./parse-csv";

describe("parseCsv", () => {
  it("splits simple rows and keeps line numbers", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      { line: 1, fields: ["a", "b"] },
      { line: 2, fields: ["1", "2"] },
    ]);
  });

  it("handles quotes, escaped quotes and commas inside quotes", () => {
    expect(parseCsv('"Smith, J","say ""hi""",3')).toEqual([
      { line: 1, fields: ["Smith, J", 'say "hi"', "3"] },
    ]);
  });

  it("keeps newlines inside quoted fields and numbers the next record correctly", () => {
    expect(parseCsv('a,"two\nlines"\nb,c')).toEqual([
      { line: 1, fields: ["a", "two\nlines"] },
      { line: 3, fields: ["b", "c"] },
    ]);
  });

  it("accepts CRLF endings, a byte-order mark and a missing final newline", () => {
    expect(parseCsv("﻿a,b\r\n1,2")).toEqual([
      { line: 1, fields: ["a", "b"] },
      { line: 2, fields: ["1", "2"] },
    ]);
  });

  it("drops blank lines but keeps empty fields", () => {
    expect(parseCsv("a,b\n\n1,\n")).toEqual([
      { line: 1, fields: ["a", "b"] },
      { line: 3, fields: ["1", ""] },
    ]);
  });

  it("reports an unclosed quote clearly", () => {
    expect(() => parseCsv('a,"b\n1,2')).toThrow("unclosed quote");
  });
});
