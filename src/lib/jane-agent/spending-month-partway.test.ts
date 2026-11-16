import { describe, expect, it } from "vitest";
import { spendingReply } from "./replies";

// Debug 2 re-walk (11-16, Plaid sandbox one month from Oct 17, 1280 light): "how much did I spend on
// food last month?" answered "You spent $114.87 on Food and drink in October 2026." with only Oct 17
// to 31 in the data. A month the data starts partway through says from when.

const row = (date: string, cents: number, pfcPrimary: string) => ({
  date,
  amountCents: cents,
  description: "TARGET T-1234 DAVIS CA",
  merchantName: null,
  pfcPrimary,
  pfcDetailed: null,
  pending: false,
});
const rows = [
  row("2026-10-17", -68_840, "INCOME"),
  row("2026-10-22", 4_287, "FOOD_AND_DRINK"),
  row("2026-10-30", 7_200, "FOOD_AND_DRINK"),
  row("2026-11-03", 2_150, "FOOD_AND_DRINK"),
];
const AS_OF = "2026-11-16";

describe("spending in a month the data starts partway through", () => {
  it("says from when", () => {
    const reply = spendingReply(
      { kind: "spending", category: "food", month: "2026-10" },
      rows,
      AS_OF,
    );
    expect(reply.body).toBe(
      "You spent $114.87 on Food and drink in October 2026 (from Oct 17, where what I have starts).",
    );
  });

  it("says nothing more for a month the data covers", () => {
    const reply = spendingReply(
      { kind: "spending", category: "food", month: "2026-11" },
      rows,
      AS_OF,
    );
    expect(reply.body).toBe("You spent $21.50 on Food and drink in November 2026 so far.");
  });
});
