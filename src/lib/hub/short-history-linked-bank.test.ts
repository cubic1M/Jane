import { describe, expect, it } from "vitest";
import { cashFlowView } from "./view";

// Debugger 11-18 (r342, Plaid S5: a bank linked a month ago): Home's "Next 30 days" said "about two
// months of statements shows them" to someone who linked a bank and has no statements to upload.
// The months come in by themselves from a linked bank; the line says what's needed either way.

describe("too little history for bills", () => {
  it("doesn't ask a linked bank for statements", () => {
    const strip = cashFlowView({
      bills: [],
      deposits: [],
      deadlines: [],
      asOf: "2026-11-18",
      historyDays: 31,
    });
    expect(strip.empty).toMatch(/^Too little history to see your bills yet/);
    expect(strip.empty).not.toMatch(/statements/);
  });
});
