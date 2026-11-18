import { describe, expect, it } from "vitest";
import { cashCushionOf, idleCashOf, type IdleTx } from "./idle-cash";

// Debugger 11-18 (r343, Plaid S4: $1,800 in checking, $980 pay every two weeks, $900 by Zelle to
// one person on each 1st, about $200 a month of everything else): "You keep $1,800.00 in cash and
// spend about $200.13 a month, so about $1,199.61 is more than 3 months of spending" and "Move idle
// cash to higher interest". The $900 is rent, filed as a transfer until the person answers "Is this
// your rent?"; it goes every month all the same, so it's a month's spending.

const ASOF = "2026-11-18";
const tx = (date: string, amountCents: number, description: string, pfc: string): IdleTx => ({
  date,
  amountCents,
  accountId: "checking",
  pfc,
  description,
});
const months = ["2026-09", "2026-10", "2026-11"];
const transactions: IdleTx[] = [
  ...months.map((m) =>
    tx(`${m}-01`, 90_000, "ZELLE TO SAM OKAFOR", "TRANSFER_OUT_TRANSFER_OUT_FROM_APPS"),
  ),
  ...months.flatMap((m) => [
    tx(`${m}-03`, 1_199, "SPOTIFY USA", "ENTERTAINMENT_MUSIC_AND_AUDIO"),
    tx(`${m}-10`, 9_000, "TRADER JOES", "FOOD_AND_DRINK_GROCERIES"),
    tx(`${m}-20`, 9_000, "TRADER JOES", "FOOD_AND_DRINK_GROCERIES"),
  ]),
  ...["2026-09-04", "2026-09-18", "2026-10-02", "2026-10-16", "2026-10-30", "2026-11-13"].map((d) =>
    tx(d, -98_000, "TRADER JOES PAYROLL", "INCOME_WAGES"),
  ),
];
const input = {
  asOf: ASOF,
  accounts: [{ id: "checking", type: "depository", subtype: "checking", balanceCents: 180_000 }],
  transactions,
};

describe("rent sent by Zelle", () => {
  it("is a month's spending in the cushion", () => {
    expect(cashCushionOf(input)!.monthlyCents).toBeGreaterThan(90_000);
  });

  it("leaves no idle cash in what pays the next rent", () => {
    expect(idleCashOf(input)).toBeNull();
  });

  it("isn't counted from one payment, which is no pattern yet", () => {
    const once = {
      ...input,
      transactions: transactions.filter(
        (t) => !(t.description === "ZELLE TO SAM OKAFOR" && t.date < "2026-11-01"),
      ),
    };
    expect(cashCushionOf(once)!.monthlyCents).toBeLessThan(90_000);
  });
});
