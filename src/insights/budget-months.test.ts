import { describe, expect, it } from "vitest";
import { setupBody } from "@/lib/jane-agent/sources/setup";
import { budgetSummary, completeMonthsWords } from "./budgets";
import type { InsightTransaction } from "./spending";

// Debug 2, 11-16 (desktop re-walk, upload S1): data from Aug 18 covers September and October in
// full, so a budget suggestion is the average of those two, and the card said "the last 3 complete
// months" over it.

const tx = (date: string, amountCents: number, pfcPrimary: string): InsightTransaction => ({
  date,
  amountCents,
  description: "SHOP",
  merchantName: null,
  pfcPrimary,
  pfcDetailed: null,
  pending: false,
});

const fromAug18 = [
  tx("2026-08-18", 1_000, "FOOD_AND_DRINK"),
  tx("2026-08-25", 4_000, "FOOD_AND_DRINK"),
  tx("2026-09-09", 8_000, "FOOD_AND_DRINK"),
  tx("2026-10-08", 12_000, "FOOD_AND_DRINK"),
  tx("2026-11-07", 3_000, "FOOD_AND_DRINK"),
];

describe("how many months a budget suggestion is the average of", () => {
  it("counts only the months the data covers in full", () => {
    const summary = budgetSummary(fromAug18, [], "2026-11-16");
    expect(summary.months).toBe(2);
    // ($80 + $120) / 2, rounded up: August's part-month is left out.
    expect(summary.suggestions["Food and drink"]).toBe(10_000);
  });

  it("is the card's own count", () => {
    const body = setupBody({
      kind: "budget",
      key: "budget:Food and drink",
      category: "Food and drink",
      amountCents: 10_000,
      months: 2,
    });
    expect(body).toContain("your own average over the last 2 complete months, rounded up");
  });

  it("says one month as one, and three for a suggestion stored before it was counted", () => {
    expect(completeMonthsWords(1)).toBe("complete month");
    expect(completeMonthsWords(3)).toBe("3 complete months");
    expect(completeMonthsWords(undefined)).toBe("3 complete months");
  });
});
