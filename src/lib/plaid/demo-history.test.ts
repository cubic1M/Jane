import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { pastMonthEndBalances, pastMonthEnds } from "./demo-history";

// A sample person's past month-end balances (the home hub's net worth line): today's balance
// with the transactions since then undone.

describe("past month ends", () => {
  it("are the last days of the months before this one, oldest first", () => {
    expect(pastMonthEnds("2026-10-23", 3)).toEqual(["2026-07-31", "2026-08-31", "2026-09-30"]);
    expect(pastMonthEnds("2026-03-05", 2)).toEqual(["2026-01-31", "2026-02-28"]);
  });
});

describe("past month-end balances", () => {
  const tx = [
    { accountId: "chk", date: "2026-08-10", amountCents: 50_000 },
    { accountId: "chk", date: "2026-09-15", amountCents: -200_000 },
    { accountId: "chk", date: "2026-10-05", amountCents: 30_000 },
    { accountId: "card", date: "2026-09-20", amountCents: 12_000 },
    { accountId: "card", date: "2026-10-02", amountCents: -5_000 },
  ];

  it("undoes a bank account's transactions since each month end", () => {
    const out = pastMonthEndBalances(
      [{ id: "chk", type: "depository", currentBalanceCents: 1_000_000 }],
      tx,
      "2026-10-23",
      3,
    );
    // Since Sep 30: 30_000 out, so it was 30_000 higher then.
    expect(out).toEqual([
      // Jul 31 is before the first transaction (Aug 10): every one of them undone.
      { accountId: "chk", date: "2026-07-31", balanceCents: 1_000_000 + 30_000 - 200_000 + 50_000 },
      { accountId: "chk", date: "2026-08-31", balanceCents: 1_000_000 + 30_000 - 200_000 },
      { accountId: "chk", date: "2026-09-30", balanceCents: 1_030_000 },
    ]);
  });

  it("undoes a card's charges and payments the other way round", () => {
    const out = pastMonthEndBalances(
      [{ id: "card", type: "credit", currentBalanceCents: 40_000 }],
      tx,
      "2026-10-23",
      2,
    );
    // Since Sep 30 a 5_000 payment lowered what's owed, so it owed 5_000 more then.
    // On Aug 31, before the 12_000 charge too: 7_000 less owed.
    expect(out).toEqual([
      { accountId: "card", date: "2026-08-31", balanceCents: 33_000 },
      { accountId: "card", date: "2026-09-30", balanceCents: 45_000 },
    ]);
  });

  it("keeps untouched accounts at today's balance, and leaves out investments and no balance", () => {
    // Every bank account the headline counts is in every month, or the line drifts off it.
    expect(
      pastMonthEndBalances(
        [
          { id: "inv", type: "investment", currentBalanceCents: 5_000_000 },
          { id: "chk", type: "depository", currentBalanceCents: null },
          { id: "sav", type: "depository", currentBalanceCents: 100 },
        ],
        tx,
        "2026-10-23",
        2,
      ),
    ).toEqual([
      { accountId: "sav", date: "2026-08-31", balanceCents: 100 },
      { accountId: "sav", date: "2026-09-30", balanceCents: 100 },
    ]);
  });
});
