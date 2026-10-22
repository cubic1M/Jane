import { describe, expect, it } from "vitest";
import type { PracticeClass } from "@/config/portfolios";
import type { Bar } from "@/lib/market/types";
import { alignBars, monthlyPath, runBacktest, worstDropOf } from "./backtest";

// Spec step 295: the backtest engine, checked against cases worked by hand.

const NO_FEES: Record<PracticeClass, number> = { us_stocks: 0, intl_stocks: 0, bonds: 0, cash: 0 };
const flat = (dates: string[], cents = 10_000): Bar[] =>
  dates.map((date) => ({ date, closeCents: cents }));
const series = (pairs: [string, number][]): Bar[] =>
  pairs.map(([date, dollars]) => ({ date, closeCents: dollars * 100 }));

describe("runBacktest", () => {
  // Half US stocks, half bonds, $10,000, a 5-point band, no fees.
  //   Dec 31, 2021: stocks $100, bonds $100. 50 units each.
  //   Jan 3, 2022: stocks $80. 4,000 + 5,000 = $9,000; stocks 44.4%, 5.6 points off: rebalance
  //     to $4,500 each (56.25 stock units, 45 bond units).
  //   Jun 30, 2022: stocks $120. 6,750 + 4,500 = $11,250; stocks 60%: rebalance to $5,625 each
  //     (46.875 stock units, 56.25 bond units).
  //   Dec 30, 2022: stocks $100. 4,687.50 + 5,625 = $10,312.50; stocks 45.5%, inside the band.
  // Worst drop: $10,000 to $9,000, -10%, back on Jun 30. 2022: $10,000 to $10,312.50, +3.125%.
  const dates = ["2021-12-31", "2022-01-03", "2022-06-30", "2022-12-30"];
  const handWorked = () =>
    runBacktest({
      weights: { us_stocks: 0.5, intl_stocks: 0, bonds: 0.5, cash: 0 },
      bars: {
        us_stocks: series([
          ["2021-12-31", 100],
          ["2022-01-03", 80],
          ["2022-06-30", 120],
          ["2022-12-30", 100],
        ]),
        intl_stocks: flat(dates),
        bonds: flat(dates),
        cash: flat(dates),
      },
      startCents: 1_000_000,
      feeBps: NO_FEES,
      bandPoints: 5,
    })!;

  it("matches the hand-worked case", () => {
    const r = handWorked();
    expect(r.path).toEqual([
      { date: "2021-12-31", valueCents: 1_000_000 },
      { date: "2022-01-03", valueCents: 900_000 },
      { date: "2022-06-30", valueCents: 1_125_000 },
      { date: "2022-12-30", valueCents: 1_031_250 },
    ]);
    expect(r.rebalances).toBe(2);
    expect(r.endCents).toBe(1_031_250);
    expect(r.totalReturn).toBeCloseTo(0.03125, 10);
    expect(r.worstDrop.fraction).toBeCloseTo(-0.1, 10);
    expect(r.worstDrop).toEqual({
      fraction: r.worstDrop.fraction,
      peakDate: "2021-12-31",
      peakCents: 1_000_000,
      troughDate: "2022-01-03",
      troughCents: 900_000,
      recoveredOn: "2022-06-30",
    });
    expect(r.feesCents).toBe(0);
  });

  it("splits the years, ranking whole years only", () => {
    const r = handWorked();
    expect(r.years).toEqual([
      expect.objectContaining({ year: 2021, whole: false, return: 0 }),
      expect.objectContaining({
        year: 2022,
        whole: true,
        startCents: 1_000_000,
        endCents: 1_031_250,
        from: "2022-01-03",
        to: "2022-12-30",
      }),
    ]);
    expect(r.years[1].return).toBeCloseTo(0.03125, 10);
    expect(r.years[1].worstDrop).toBeCloseTo(-0.1, 10);
    expect(r.bestYear?.year).toBe(2022);
    expect(r.worstYear?.year).toBe(2022);
  });

  it("takes each fund's yearly cost out a little every trading day", () => {
    // All cash at a flat price, 252 basis points a year: 1 basis point a trading day.
    const d = ["2024-01-02", "2024-01-03", "2024-01-04"];
    const r = runBacktest({
      weights: { us_stocks: 0, intl_stocks: 0, bonds: 0, cash: 1 },
      bars: { us_stocks: flat(d), intl_stocks: flat(d), bonds: flat(d), cash: flat(d) },
      startCents: 1_000_000,
      feeBps: { ...NO_FEES, cash: 252 },
      bandPoints: 5,
    })!;
    // 1,000,000 × 0.9999 = 999,900; × 0.9999 = 999,800.01.
    expect(r.path.map((p) => p.valueCents)).toEqual([1_000_000, 999_900, 999_800]);
    expect(r.feesCents).toBe(200);
    expect(r.rebalances).toBe(0);
  });

  it("charges the trading cost on what changes hands at a rebalance", () => {
    const r = runBacktest({
      weights: { us_stocks: 0.5, intl_stocks: 0, bonds: 0.5, cash: 0 },
      bars: {
        us_stocks: series([
          ["2021-12-31", 100],
          ["2022-01-03", 80],
        ]),
        intl_stocks: flat(dates.slice(0, 2)),
        bonds: flat(dates.slice(0, 2)),
        cash: flat(dates.slice(0, 2)),
      },
      startCents: 1_000_000,
      feeBps: NO_FEES,
      bandPoints: 5,
      tradeCostBps: 100,
    })!;
    // $9,000 before; $500 of bonds sold and $500 of stocks bought: 1% of $1,000 is $10.
    expect(r.endCents).toBe(899_000);
  });

  it("uses only the days every fund has, and needs two of them", () => {
    const days = alignBars({
      us_stocks: flat(["2024-01-02", "2024-01-03", "2024-01-04"]),
      intl_stocks: flat(["2024-01-02", "2024-01-04"]),
      bonds: flat(["2024-01-02", "2024-01-03", "2024-01-04"]),
      cash: flat(["2024-01-02", "2024-01-03", "2024-01-04"]),
    });
    expect(days.map((d) => d.date)).toEqual(["2024-01-02", "2024-01-04"]);
    const one = flat(["2024-01-02"]);
    expect(
      runBacktest({
        weights: { us_stocks: 1, intl_stocks: 0, bonds: 0, cash: 0 },
        bars: { us_stocks: one, intl_stocks: one, bonds: one, cash: one },
        startCents: 1_000_000,
        feeBps: NO_FEES,
        bandPoints: 5,
      }),
    ).toBeNull();
  });
});

describe("worstDropOf", () => {
  it("is zero for a path that never falls, and says when it hasn't recovered", () => {
    const up = [
      { date: "2024-01-02", valueCents: 100 },
      { date: "2024-01-03", valueCents: 110 },
    ];
    expect(worstDropOf(up).fraction).toBe(0);
    const down = worstDropOf([
      { date: "2024-01-02", valueCents: 100 },
      { date: "2024-01-03", valueCents: 120 },
      { date: "2024-01-04", valueCents: 90 },
      { date: "2024-01-05", valueCents: 100 },
    ]);
    expect(down.fraction).toBeCloseTo(-0.25, 10);
    expect(down.peakDate).toBe("2024-01-03");
    expect(down.recoveredOn).toBeNull();
  });
});

describe("monthlyPath", () => {
  it("keeps the first day and each month's last trading day", () => {
    const path = ["2024-01-02", "2024-01-31", "2024-02-01", "2024-02-29", "2024-03-01"].map(
      (date, i) => ({ date, valueCents: i }),
    );
    expect(monthlyPath(path).map((p) => p.date)).toEqual([
      "2024-01-02",
      "2024-01-31",
      "2024-02-29",
      "2024-03-01",
    ]);
  });
});
