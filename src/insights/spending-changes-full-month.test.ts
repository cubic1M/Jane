import { describe, expect, it } from "vitest";
import { spendingInsights } from "./spending";

// Debug 2 (11-16, a Plaid sandbox checking account with one month of history, Oct 17 – Nov 14):
// Spending & bills said "Rent and utilities is up +$935: $935.00 this month, up from $0.00 last
// month". The data starts Oct 17, after October's rent: a month the data barely covers isn't "last
// month" to compare with. Changes are only against a month covered (nearly) whole.

const tx = (date: string, cents: number, pfc: string, description: string) => ({
  date,
  amountCents: cents,
  description,
  merchantName: null,
  pfcPrimary: pfc.split("_").slice(0, -1).join("_") || pfc,
  pfcDetailed: pfc,
  pending: false,
});
const rent = (date: string) =>
  tx(date, 87_500, "RENT_AND_UTILITIES_RENT", "ZELLE TO RIVERA K RENT");
const food = (date: string, cents: number) =>
  tx(date, cents, "FOOD_AND_DRINK_GROCERIES", "SAFEWAY #0921 DAVIS CA");

describe("this month against last, in spending insights", () => {
  it("isn't compared with a month the data starts halfway through", () => {
    const rows = [food("2026-10-17", 3_000), food("2026-10-25", 2_500), rent("2026-11-01")];
    const s = spendingInsights(rows, { asOf: "2026-11-16", monthCount: 3 });
    expect(s.changes).toEqual([]);
    expect(s.changeMonths).toBeNull();
  });

  it("is compared with a month the data covers", () => {
    const rows = [food("2026-10-02", 3_000), food("2026-10-25", 2_500), rent("2026-11-01")];
    const s = spendingInsights(rows, { asOf: "2026-11-16", monthCount: 3 });
    expect(s.changeMonths).toEqual({ before: "2026-10", after: "2026-11" });
    expect(s.changes.map((c) => c.category)).toContain("Rent and utilities");
  });
});
