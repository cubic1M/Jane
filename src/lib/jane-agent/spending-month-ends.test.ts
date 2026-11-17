import { describe, expect, it } from "vitest";
import { spendingReply } from "./replies";

// Debug 2, third desktop sweep (11-16, upload S7: a Bank of America statement Jun 1 to Oct 20,
// uploaded weeks later): "how much did I spend in October?" answered "You spent $1,235.64 in
// October 2026. That's $87.67 less than in September." October was cut at the 20th. A month the
// data ends partway through says to when, and isn't held against a whole month.

const row = (date: string, cents: number, pfcPrimary: string) => ({
  date,
  amountCents: cents,
  description: "CHECKCARD TRADER JOES #127",
  merchantName: null,
  pfcPrimary,
  pfcDetailed: null,
  pending: false,
});
const rows = [
  row("2026-08-01", 4_000, "FOOD_AND_DRINK"),
  row("2026-09-03", 98_000, "RENT_AND_UTILITIES"),
  row("2026-09-12", 30_000, "FOOD_AND_DRINK"),
  row("2026-10-03", 98_000, "RENT_AND_UTILITIES"),
  row("2026-10-12", 12_000, "FOOD_AND_DRINK"),
  row("2026-10-20", 1_200, "BANK_FEES"),
];
const AS_OF = "2026-11-16";

describe("spending in a month the data ends partway through", () => {
  it("says to when, with nothing held against a whole month", () => {
    const reply = spendingReply(
      { kind: "spending", category: null, month: "2026-10" },
      rows,
      AS_OF,
    );
    expect(reply.body).toMatch(
      /^You spent \$1,112\.00 in October 2026 \(to Oct 20, where what I have ends\)\./,
    );
    expect(reply.body).not.toMatch(/than in September/);
  });

  it("compares a month the data covers", () => {
    const reply = spendingReply(
      { kind: "spending", category: "food", month: "2026-09" },
      rows,
      AS_OF,
    );
    expect(reply.body).toContain("You spent $300.00 on Food and drink in September 2026. That's");
  });
});
