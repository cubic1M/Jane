import { describe, expect, it } from "vitest";
import { figureOf } from "./ledger-entry";

describe("figureOf", () => {
  it("says an estimate's figure a year, and a counted one as it is", () => {
    expect(figureOf({ cents: 41_600, yearly: true, state: "estimated" })).toBe("about $416.00/yr");
    expect(figureOf({ cents: 9_588, yearly: true, state: "verified" })).toBe("$95.88/yr");
  });

  // Night QA 10-30: a low balance marked done read "about $0.00/yr".
  it("says there's no dollar estimate rather than about $0.00", () => {
    expect(figureOf({ cents: 0, yearly: true, state: "done" })).toBe("No dollar estimate");
    expect(figureOf({ cents: 0, yearly: true, state: "estimated" })).toBe("No dollar estimate");
  });
});
