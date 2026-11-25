import { describe, expect, it } from "vitest";
import { groupsCountedElsewhere, planTotal } from "./overlap";

// CodeRabbit 1c detn-01 #6 and #8. A duplicate group's saving is the cheaper service's yearly
// cost, which that service's own review already carries; and a review that adds no dollars (an
// unconfirmed guess, saving null) covers nothing beside it.

const review = (merchant: string, cents: number | null) => ({
  type: "subscription_review",
  evidence: { merchant },
  annualSavingsCents: cents,
});
const rise = (merchant: string, cents: number) => ({
  type: "price_increase",
  evidence: { merchant },
  annualSavingsCents: cents,
});
// The group's saving is the cheaper service's yearly cost, as the rule writes it.
const group = (services: [string, number][]) => ({
  type: "duplicate_subscription",
  evidence: {
    services: services.map(([merchant, annualCostCents]) => ({ merchant, annualCostCents })),
  },
  annualSavingsCents: Math.min(...services.map(([, c]) => c)),
});

describe("a group whose cheaper service has a review", () => {
  const services: [string, number][] = [
    ["Netflix", 12_000],
    ["Hulu", 21_588],
  ];

  it("counts the cheaper service once, though the dearer one has no review", () => {
    const rows = [group(services), review("Netflix", 12_000)];
    expect(planTotal(rows)).toBe(12_000);
    expect(groupsCountedElsewhere(rows).size).toBe(1);
  });

  it("keeps the group's saving when only the dearer service has a review", () => {
    const rows = [group(services), review("Hulu", 21_588)];
    expect(planTotal(rows)).toBe(12_000 + 21_588);
  });
});

describe("a review that adds no dollars", () => {
  it("leaves the price rise on the same merchant in the total", () => {
    const rows = [review("Hulu", null), rise("Hulu", 2_400)];
    expect(planTotal(rows)).toBe(2_400);
  });

  it("leaves a group in the total when its reviews are all guesses", () => {
    const rows = [
      group([
        ["Netflix", 12_000],
        ["Hulu", 21_588],
      ]),
      review("Netflix", null),
      review("Hulu", null),
    ];
    expect(planTotal(rows)).toBe(12_000);
  });
});
