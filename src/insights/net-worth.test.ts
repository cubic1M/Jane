import { describe, expect, it } from "vitest";
import { monthlyNetWorth, netWorth, netWorthLine, netWorthOn, notCounting } from "./net-worth";

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
      ownedCents: 0,
      cryptoCents: 0,
      debtsCents: 920_000,
      netCents: 330_000,
      missing: ["Old Card"],
    });
  });

  it("counts crypto (spec step 161) as an asset, at what its exchange or wallet reported", () => {
    expect(netWorth(accounts, [], 822_993)).toMatchObject({
      assetsCents: 1_250_000 + 822_993,
      investmentsCents: 0,
      cryptoCents: 822_993,
      netCents: 330_000 + 822_993,
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

describe("netWorth with things you own", () => {
  it("counts them as assets at the person's values, and says how much", () => {
    const owned = [
      { id: "house", valueCents: 45_000_000, valuedOn: "2026-09-01" },
      { id: "car", valueCents: 1_800_000, valuedOn: "2025-01-15" },
    ];
    expect(netWorth(accounts, owned)).toMatchObject({
      assetsCents: 1_250_000 + 46_800_000,
      ownedCents: 46_800_000,
      investmentsCents: 0,
      debtsCents: 920_000,
      netCents: 330_000 + 46_800_000,
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

describe("monthlyNetWorth with things you own", () => {
  it("counts each from the month of its value, like an account with one snapshot", () => {
    const months = monthlyNetWorth(
      accounts,
      [
        { accountId: "chk", date: "2026-08-31", balanceCents: 150_000 },
        { accountId: "loan", date: "2026-08-31", balanceCents: 800_000 },
      ],
      "2026-10-20",
      4,
      [
        // Valued in September: not counted in August.
        { id: "house", valueCents: 45_000_000, valuedOn: "2026-09-12" },
        // Valued long ago: counted in every month.
        { id: "car", valueCents: 1_000_000, valuedOn: "2025-01-15" },
      ],
    );
    expect(months).toEqual([
      { month: "2026-07", netCents: 1_000_000 },
      { month: "2026-08", netCents: 150_000 - 800_000 + 1_000_000 },
      { month: "2026-09", netCents: 150_000 - 800_000 + 46_000_000 },
      { month: "2026-10", netCents: 150_000 - 800_000 + 46_000_000 },
    ]);
  });

  it("doesn't mix up a thing owned with an account that has the same id", () => {
    const months = monthlyNetWorth(
      [{ id: "x", type: "credit" }],
      [{ accountId: "x", date: "2026-10-01", balanceCents: 5_000 }],
      "2026-10-20",
      1,
      [{ id: "x", valueCents: 100_000, valuedOn: "2026-10-01" }],
    );
    expect(months).toEqual([{ month: "2026-10", netCents: 95_000 }]);
  });
});

// The line the hub and /net-worth both draw (phone walk: they disagreed).
describe("netWorthLine", () => {
  const accounts = [
    { id: "chk", type: "depository", currentBalanceCents: 50_000 },
    { id: "inv", type: "investment", currentBalanceCents: 1_000_000 },
  ];
  const snapshots = [
    { accountId: "chk", date: "2026-08-31", balanceCents: 30_000 },
    { accountId: "chk", date: "2026-09-30", balanceCents: 40_000 },
  ];
  const car = { id: "car", valueCents: 1_400_000, valuedOn: "2026-10-20" };

  it("counts what has no history, and what's owned, in every month, and ends at today", () => {
    const line = netWorthLine(accounts, snapshots, [car], "2026-10-23", 3, 2_450_000);
    expect(line).toEqual([
      // August: checking's month end, the investments and the car at their value now.
      { month: "2026-08", netCents: 30_000 + 1_000_000 + 1_400_000 },
      { month: "2026-09", netCents: 40_000 + 1_000_000 + 1_400_000 },
      // This month is the headline itself.
      { month: "2026-10", netCents: 2_450_000 },
    ]);
  });

  it("shows only this month with no history at all, never a made-up flat year", () => {
    expect(netWorthLine(accounts, [], [car], "2026-10-23", 3, 2_450_000)).toEqual([
      { month: "2026-08", netCents: null },
      { month: "2026-09", netCents: null },
      { month: "2026-10", netCents: 2_450_000 },
    ]);
  });
});

describe("notCounting", () => {
  it("names what net worth leaves out, never silently", () => {
    expect(notCounting([])).toBeNull();
    expect(notCounting(["Chase card"])).toEqual({
      short: "not counting Chase card",
      sentence: "Not counting Chase card: there's no balance yet.",
    });
    expect(notCounting(["Amex", "Chase card"])?.short).toBe("not counting Amex or Chase card");
    expect(notCounting(["A", "B", "C"])?.short).toBe("not counting 3 accounts");
  });
});
