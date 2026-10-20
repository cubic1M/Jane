import { describe, expect, it } from "vitest";
import { groupsCountedElsewhere, planTotal } from "./overlap";

// Spec step 263 (QA sweep): "You pay for 2 video streaming services $185.88" beside "Review
// your Netflix $185.88" counted the same money twice in "worth up to" (Maya $1,981, the Reyes
// $3,773).

const review = (merchant: string, cents: number) => ({
  type: "subscription_review",
  evidence: { merchant },
  annualSavingsCents: cents,
});
const group = (merchants: string[], cents: number) => ({
  type: "duplicate_subscription",
  evidence: { services: merchants.map((merchant) => ({ merchant })) },
  annualSavingsCents: cents,
});

describe("the plan total", () => {
  it("counts Maya's Netflix once: the group's dollars are in the reviews beside it", () => {
    const rows = [
      group(["Netflix", "Hulu"], 18_588),
      review("Netflix", 18_588),
      review("Hulu", 21_588),
    ];
    expect(planTotal(rows)).toBe(18_588 + 21_588);
    expect(groupsCountedElsewhere(rows).size).toBe(1);
  });

  it("counts the Reyes' three streaming services once", () => {
    const rows = [
      group(["Netflix", "Hulu", "Disney+"], 16_788),
      review("Netflix", 18_588),
      review("Hulu", 21_588),
      review("Disney+", 16_788),
      review("Planet Fitness", 58_800),
    ];
    expect(planTotal(rows)).toBe(18_588 + 21_588 + 16_788 + 58_800);
  });

  it("counts the group when a service in it has no review of its own", () => {
    const rows = [group(["Netflix", "Hulu"], 18_588), review("Netflix", 18_588)];
    expect(planTotal(rows)).toBe(18_588 + 18_588);
  });

  it("leaves other rows alone, and nulls count as nothing", () => {
    expect(
      planTotal([
        { type: "bank_fees", evidence: {}, annualSavingsCents: 10_500 },
        { type: "idle_cash", evidence: {}, annualSavingsCents: null },
      ]),
    ).toBe(10_500);
  });
});
