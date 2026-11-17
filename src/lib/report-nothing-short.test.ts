import { describe, expect, it } from "vitest";
import { nothingHeading, nothingLine } from "./report-state";

// Debugger 11-17 (r329, Plaid sandbox, one month of a new checking account, phone): the report
// read "Nothing to fix right now. Jane read 14 transactions and ran 11 checks." while 7 of the 11
// said "Not enough data yet". "Nothing to fix" is for checks that could run; with most of them
// waiting, it's "Nothing found yet", and the line says how many ran.

const lines = (passed: number, waiting: number) => [
  ...Array.from({ length: passed }, () => ({ status: "passed" as const })),
  ...Array.from({ length: waiting }, () => ({ status: "not_enough_data" as const })),
];

describe("the report with nothing found", () => {
  it("is 'nothing found yet' when most checks had too little to go on", () => {
    expect(nothingHeading(null, lines(4, 7))).toBe("Nothing found yet");
    expect(nothingLine(14, lines(4, 7))).toBe(
      "Jane read 14 transactions and ran 4 of 11 checks; the rest don't have enough to go on yet. Tap one to see what it looked at.",
    );
  });

  it("is still 'nothing to fix' when most of them ran", () => {
    expect(nothingHeading(null, lines(8, 3))).toBe("Nothing to fix right now");
    expect(nothingLine(240, lines(11, 0))).toBe(
      "Jane read 240 transactions and ran 11 checks. Tap one to see what it looked at.",
    );
  });

  it("still names old statements first", () => {
    expect(nothingHeading("2026-09-28", lines(4, 7))).toBe("Nothing found in these old statements");
  });
});
