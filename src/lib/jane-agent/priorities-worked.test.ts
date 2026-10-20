import { describe, expect, it } from "vitest";
import { confidenceFor } from "./priorities";

// Spec step 207: ranking learns from results. A kind that has worked ranks sure; one the
// person keeps declining, or whose finished actions never showed a saving, ranks uncertain.

const row = (over: Partial<NonNullable<Parameters<typeof confidenceFor>[2]>[number]>) => ({
  type: "bill_negotiation" as const,
  yes: 0,
  no: 0,
  done: 0,
  worked: 0,
  notShown: 0,
  workedCents: 0,
  ...over,
});

describe("confidenceFor", () => {
  it("keeps the finding's own confidence with nothing learned", () => {
    expect(confidenceFor("bill_negotiation", "medium", undefined)).toBe("medium");
    expect(confidenceFor("bill_negotiation", "medium", [row({ yes: 1, done: 1 })])).toBe("medium");
  });

  it("is sure of a kind that has worked", () => {
    expect(confidenceFor("bill_negotiation", "medium", [row({ done: 2, worked: 1 })])).toBe("high");
  });

  it("is unsure of a kind that never showed a saving, or keeps being declined", () => {
    expect(confidenceFor("bill_negotiation", "high", [row({ done: 3, notShown: 3 })])).toBe("low");
    expect(confidenceFor("bill_negotiation", "high", [row({ no: 3 })])).toBe("low");
    expect(confidenceFor("bill_negotiation", "high", [row({ no: 3, yes: 1 })])).toBe("high");
  });

  it("leaves other kinds alone", () => {
    expect(confidenceFor("bank_fees", "medium", [row({ done: 5, notShown: 5 })])).toBe("medium");
  });
});
