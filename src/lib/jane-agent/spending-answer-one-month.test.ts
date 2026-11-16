import { describe, expect, it } from "vitest";
import { spendingReply } from "./replies";

// Debug 2 (11-16, a Plaid sandbox checking account from Oct 17, the side chat at 1280 light): "how
// much did I spend this month?" → "You spent $1,125.20 in November 2026 so far. In all of October
// it was $292.31. The most went to: Rent and utilities $935.00, …", with the same three categories
// drawn as bars under it. The data has half of October, so there's no "all of October" to give;
// and with the bars drawn, the words don't name the biggest again.

const tx = (date: string, cents: number, pfcDetailed: string) => ({
  date,
  amountCents: cents,
  description: "SAFEWAY #0921 DAVIS CA",
  merchantName: null,
  pfcPrimary: pfcDetailed.replace(/_[A-Z]+$/, ""),
  pfcDetailed,
  pending: false,
});
const rows = [
  tx("2026-10-17", 29_231, "FOOD_AND_DRINK_GROCERIES"),
  tx("2026-11-01", 93_500, "RENT_AND_UTILITIES_RENT"),
  tx("2026-11-05", 13_668, "FOOD_AND_DRINK_GROCERIES"),
];
const intent = { kind: "spending", category: null, month: "2026-11" } as Parameters<
  typeof spendingReply
>[0];

describe("this month's spending in the chat", () => {
  it("isn't compared with a month the data starts halfway through", () => {
    expect(spendingReply(intent, rows, "2026-11-16").body).not.toContain("In all of October");
  });

  it("doesn't name the biggest categories when the bars below show them", () => {
    const body = spendingReply(intent, rows, "2026-11-16", null, { drawn: true }).body;
    expect(body).toBe("You spent $1,071.68 in November 2026 so far.");
  });
});
