import { describe, expect, it } from "vitest";
import { groupsCountedElsewhere, planTotal } from "./overlap";

// Debugger 11-16 (a U.S. Bank checking upload on a phone): the plan said "4 things you could do,
// worth up to about $431.16 a year if you do them all": Amazon Prime $179.88, Hulu $143.88 (its
// whole year at the new $11.99), "Hulu went up from $9.99 to $11.99" $24 and bank fees $83.40.
// Cancelling Hulu already saves its rise, so the $24 was counted twice. Both stay on the plan.

const review = (merchant: string, cents: number) => ({
  type: "subscription_review",
  evidence: { merchant },
  annualSavingsCents: cents,
});
const rise = (merchant: string, cents: number) => ({
  type: "price_increase",
  evidence: { merchant, priorAverageCents: 999 },
  annualSavingsCents: cents,
});
const fees = { type: "bank_fees", evidence: {}, annualSavingsCents: 8_340 };

describe("a price rise on a service with its own review", () => {
  it("is in the plan's total once, inside the review", () => {
    const rows = [
      review("Amazon Prime", 17_988),
      review("Hulu", 14_388),
      rise("Hulu", 2_400),
      fees,
    ];
    expect(planTotal(rows)).toBe(17_988 + 14_388 + 8_340);
    expect(groupsCountedElsewhere(rows)).toEqual(new Set([rows[2]]));
  });

  it("counts on its own when nothing reviews that service", () => {
    const rows = [review("Amazon Prime", 17_988), rise("Hulu", 2_400)];
    expect(planTotal(rows)).toBe(17_988 + 2_400);
  });
});
