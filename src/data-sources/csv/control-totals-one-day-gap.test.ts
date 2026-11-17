import { describe, expect, it } from "vitest";
import { readCsvFile } from "./csv-source";

// Main's property test, 11-17 (seed -858575156): a one-day statement with its second row taken out
// read as whole. What was left was a $0.02 debit and, apart from it, +$0.15 and -$0.15 that lead to
// each other: each day's balances were checked for one closing row, and the debit alone was one, so
// the pair that never connects to it went unnoticed. The same day with its third row taken out
// connects, but two rows end at one balance that only one leaves. A day's rows make one run from
// one balance to the next; more than one is a row missing between them.

const read = (rows: [string, string, string][]) => {
  const result = readCsvFile({
    name: "s.csv",
    text: [
      "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
      ...rows.map(
        ([what, amount, balance]) => `DEBIT,01/02/2026,${what},${amount},MISC,${balance},`,
      ),
    ].join("\n"),
  });
  if (!result.ok) throw new Error(result.error);
  return result.control.warnings.map((w) => w.code);
};

describe("a one-day statement", () => {
  it("with a row missing from between its rows says so", () => {
    // Rows 0, 2 and 3 of -0.02 (-0.02), -0.02 (-0.04), +0.15 (0.11), -0.15 (-0.04).
    const codes = read([
      ["ROW 0", "-0.02", "-0.02"],
      ["ROW 2", "0.15", "0.11"],
      ["ROW 3", "-0.15", "-0.04"],
    ]);
    expect(codes.some((c) => c === "balance_gap" || c === "not_a_balance")).toBe(true);
  });

  it("with a row missing where two rows end at one balance says so", () => {
    // Rows 0, 1 and 3: -0.02 (-0.02), -0.02 (-0.04), -0.15 (-0.04).
    const codes = read([
      ["ROW 0", "-0.02", "-0.02"],
      ["ROW 1", "-0.02", "-0.04"],
      ["ROW 3", "-0.15", "-0.04"],
    ]);
    expect(codes.some((c) => c === "balance_gap" || c === "not_a_balance")).toBe(true);
  });

  it("whole, says nothing, and whole with rows that cancel out says nothing either", () => {
    expect(
      read([
        ["ROW 0", "-0.02", "-0.02"],
        ["ROW 1", "-0.02", "-0.04"],
        ["ROW 2", "0.15", "0.11"],
        ["ROW 3", "-0.15", "-0.04"],
      ]).filter((c) => c === "balance_gap" || c === "not_a_balance"),
    ).toEqual([]);
    expect(
      read([
        ["IN", "20.00", "20.00"],
        ["OUT", "-20.00", "0.00"],
      ]).filter((c) => c === "balance_gap" || c === "not_a_balance"),
    ).toEqual([]);
  });
});
