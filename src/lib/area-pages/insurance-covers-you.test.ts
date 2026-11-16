import { describe, expect, it } from "vitest";
import { insuranceTree, type InsuranceTreeInput } from "./insurance";

// Debugger 11-16: Insurance → Your household's cover → "You: None. No policy on file covers
// them." The person's own row says "you"; anyone else in the household stays "them".

const summaries = (household: InsuranceTreeInput["household"]) =>
  insuranceTree({
    asOf: "2026-11-16",
    needs: [],
    policies: [],
    gaps: [],
    savings: [],
    renewals: [],
    changes: [],
    readings: [],
    payingTwice: [],
    cards: [],
    household,
    risks: [],
    health: null,
  }).summaries;

describe("the household's cover rows", () => {
  it("speak to the person on their own row", () => {
    const s = summaries([
      { name: "You", policies: 0 },
      { name: "Sam", policies: 0 },
      { name: "Alex", policies: 2 },
    ]);
    expect(s["household:You"]).toBe("No policy on file covers you.");
    expect(s["household:Sam"]).toBe("No policy on file covers them.");
    expect(s["household:Alex"]).toBe("Who covers them is below.");
  });
});
