import { describe, expect, it } from "vitest";
import { monthlyNetWorth, netWorth, netWorthOn } from "./net-worth";

const accounts = [
  { id: "chk", name: "Checking", type: "depository", balanceCents: 250_000 },
  { id: "sav", name: "Savings", type: "depository", balanceCents: 1_000_000 },
  { id: "card", name: "Rewards Card", type: "credit", balanceCents: 120_000 },
  { id: "loan", name: "Car Loan", type: "loan", balanceCents: 800_000 },
  { id: "csv", name: "Old Card", type: "credit", balanceCents: null },
];

describe("netWorth", () => {
  it("counts cards and loans as debts, and lists accounts without a balance", () => {
    expect(netWorth(accounts)).toEqual({
      assetsCents: 1_250_000,
      investmentsCents: 0,
      debtsCents: 920_000,
      netCents: 330_000,
      missing: ["Old Card"],
    });
  });

  it("counts investment and retirement balances as assets, and says how much", () => {
    const withInvestments = [
      ...accounts,
      { id: "401k", name: "401(k)", type: "investment", balanceCents: 8_425_040 },
    ];
    expect(netWorth(withInvestments)).toMatchObject({
      assetsCents: 1_250_000 + 8_425_040,
      investmentsCents: 8_425_040,
      netCents: 330_000 + 8_425_040,
    });
  });
});

describe("netWorthOn", () => {
  it("uses each account's last snapshot on or before the day", () => {
    const snapshots = [
      { accountId: "chk", date: "2026-10-01", balanceCents: 100_000 },
      { accountId: "chk", date: "2026-10-10", balanceCents: 150_000 },
      { accountId: "card", date: "2026-10-05", balanceCents: 20_000 },
    ];
    expect(netWorthOn(accounts, snapshots, "2026-10-08")).toBe(80_000);
    expect(netWorthOn(accounts, snapshots, "2026-09-01")).toBeNull();
  });
});

describe("monthlyNetWorth", () => {
  it("uses each account's last snapshot in or before each month", () => {
    const months = monthlyNetWorth(
      accounts,
      [
        { accountId: "chk", date: "2026-08-10", balanceCents: 100_000 },
        { accountId: "chk", date: "2026-08-31", balanceCents: 150_000 },
        { accountId: "card", date: "2026-08-31", balanceCents: 50_000 },
        { accountId: "chk", date: "2026-10-01", balanceCents: 200_000 },
        // An account the person no longer has is ignored.
        { accountId: "gone", date: "2026-10-01", balanceCents: 9_999_999 },
      ],
      "2026-10-20",
      4,
    );
    expect(months).toEqual([
      { month: "2026-07", netCents: null },
      { month: "2026-08", netCents: 100_000 },
      // No new snapshots in September: August's carry forward.
      { month: "2026-09", netCents: 100_000 },
      { month: "2026-10", netCents: 150_000 },
    ]);
  });
});
