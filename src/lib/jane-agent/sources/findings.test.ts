import { describe, expect, it } from "vitest";
import { findingCandidate } from "./findings";

// A finding's line in the day's agenda (phone walk): its title and what it could save, or its
// title alone when there's no dollar figure to add.

const finding = (over: Partial<Parameters<typeof findingCandidate>[0]> = {}) =>
  findingCandidate({
    findingId: "f1",
    type: "subscription_review",
    title: "Review your Spotify subscription",
    annualSavingsCents: 14_388,
    savings: "Could save about $143.88 a year",
    fingerprint: "fp",
    urgent: false,
    pick: null,
    ...over,
  });

describe("a finding's agenda line", () => {
  it("adds what it could save", () => {
    expect(finding().bundle?.line).toBe(
      "Review your Spotify subscription: could save about $143.88 a year",
    );
  });

  it("is the title alone with no dollar estimate", () => {
    const line = finding({
      type: "low_balance_risk",
      title: "Demo Checking could drop to -$470.80 around Nov 14",
      annualSavingsCents: null,
      savings: "No dollar estimate for this one",
    }).bundle?.line;
    expect(line).toBe("Demo Checking could drop to -$470.80 around Nov 14");
  });

  it("keeps the quotes line for an insurance reshop", () => {
    const line = finding({
      type: "insurance_reshop",
      title: "Your AARP insurance could cost less",
      annualSavingsCents: null,
      savings: "Savings depend on the quotes we find",
    }).bundle?.line;
    expect(line).toBe("Your AARP insurance could cost less: savings depend on the quotes we find");
  });
});
