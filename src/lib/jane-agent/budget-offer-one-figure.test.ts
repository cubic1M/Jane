import { describe, expect, it } from "vitest";
import { budgetSummary } from "@/insights/budgets";
import { spendingReply } from "./replies";

// Debug 2 (11-15, a student with 14 months of statements, 1280 light): asked "how much did I spend
// on food last month?", the chat said "A $239.00 budget would match a usual month" while the dock
// offered "I could set a $240.00 monthly budget for Food and drink": one average, rounded up to
// the dollar in the chat and to $10 on the Budgets page and the dock. The chat now offers the
// Budgets page's own figure.

const food = (date: string, cents: number) => ({
  date,
  amountCents: cents,
  description: "TRADER JOE S #127 BERKELEY CA",
  merchantName: null,
  pfcPrimary: "FOOD_AND_DRINK",
  pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
  pending: false,
});
// $238.50 of groceries in each of August, September and October, and some of November.
const rows = ["2026-07-01", "2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"].map((d, i) =>
  food(d, i === 0 ? 1_000 : 23_850),
);
const AS_OF = "2026-11-15";

describe("the budget the chat offers", () => {
  it("is the Budgets page's figure for the category", () => {
    const page = budgetSummary(rows, [], AS_OF).suggestions["Food and drink"];
    expect(page).toBe(24_000);
    const reply = spendingReply(
      { kind: "spending", category: "food", month: "2026-10" },
      rows,
      AS_OF,
      [],
    );
    expect(reply.body).toContain("A $240.00 budget would match a usual month.");
  });
});
