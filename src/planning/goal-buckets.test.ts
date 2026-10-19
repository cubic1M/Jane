import { describe, expect, it } from "vitest";
import { CORE_FUNDS } from "@/config/funds";
import { GLIDE_PATH, NEAR_TERM_YEARS, TARGET_MIXES, type RiskLevel } from "@/config/investing";
import { glideMix, goalBuckets, splitNewMoney, yearsUntil } from "./goal-buckets";

// Spec step 157: a near-term goal is never put in stocks; the glide path is shown and
// tested.

const LEVELS: RiskLevel[] = [1, 2, 3, 4, 5];
const stocks = (m: ReturnType<typeof glideMix>) => m.us_stocks + m.intl_stocks;

describe("the glide path", () => {
  it("adds up at every step and gets safer as the date nears", () => {
    let last = Infinity;
    for (const g of GLIDE_PATH) {
      expect(g.stocks + g.bonds + g.cash).toBeCloseTo(1, 10);
      expect(g.stocks).toBeLessThanOrEqual(last);
      last = g.stocks;
    }
  });

  it("never puts a near-term goal in stocks, at any risk level", () => {
    for (const level of LEVELS) {
      for (let years = 0; years < NEAR_TERM_YEARS; years += 0.25) {
        const m = glideMix(years, level);
        expect(stocks(m), `${level} ${years}`).toBe(0);
        expect(m.cash).toBe(1);
      }
    }
  });

  it("follows the path, capped at the risk level's stocks", () => {
    expect(stocks(glideMix(20, 5))).toBeCloseTo(0.9, 10);
    expect(stocks(glideMix(12, 5))).toBeCloseTo(0.7, 10);
    expect(stocks(glideMix(7, 5))).toBeCloseTo(0.5, 10);
    expect(stocks(glideMix(4, 5))).toBeCloseTo(0.3, 10);
    // A conservative profile never goes above its own 30% stocks.
    const t = TARGET_MIXES[1];
    expect(stocks(glideMix(20, 1))).toBeCloseTo(t.us_stocks + t.intl_stocks, 10);
    for (const level of LEVELS) {
      for (const years of [3, 5, 10, 15, 30]) {
        const m = glideMix(years, level);
        expect(m.us_stocks + m.intl_stocks + m.bonds + m.cash).toBeCloseTo(1, 10);
      }
    }
  });
});

describe("goalBuckets and splitNewMoney", () => {
  const goals = [
    { id: "house", name: "House", targetDate: "2028-10-01", monthlyCents: 50_000 },
    { id: "trip", name: "Trip", targetDate: "2033-10-01", monthlyCents: 20_000 },
    { id: "retirement", name: "Retirement", targetDate: "2048-10-19", monthlyCents: 0 },
  ];
  const buckets = goalBuckets(goals, "2026-10-19", 3);

  it("gives each goal a mix by when it's needed, with a reason", () => {
    expect(buckets.map((b) => [b.id, b.nearTerm])).toEqual([
      ["house", true],
      ["trip", false],
      ["retirement", false],
    ]);
    expect(buckets[0].why).toMatch(/^2 years away: kept in cash/);
    expect(buckets[1].why).toMatch(/^7 years away: 50% stocks/);
    expect(yearsUntil("2026-10-19", "2026-01-01")).toBe(0);
  });

  it("fills near-term goals first, in cash, then the rest by need, to the cent", () => {
    const split = splitNewMoney(60_000, buckets);
    expect(split.perBucket).toEqual([
      { id: "house", amountCents: 50_000 },
      { id: "trip", amountCents: 10_000 },
    ]);
    const bought = split.buys.reduce((s, b) => s + b.amountCents, 0);
    expect(bought + split.cashCents).toBe(60_000);
    // The house money is all cash: only the trip's share is bought.
    expect(bought).toBeLessThanOrEqual(10_000);
    expect(split.cashCents).toBeGreaterThanOrEqual(50_000);
    expect(split.buys.map((b) => b.ticker).sort()).toEqual(
      [CORE_FUNDS.bonds, CORE_FUNDS.intl_stocks, CORE_FUNDS.us_stocks].sort(),
    );
  });

  it("never buys stocks with near-term money, however much comes in", () => {
    const onlySoon = goalBuckets([goals[0]], "2026-10-19", 5);
    for (const amount of [100, 10_000, 1_000_000]) {
      const split = splitNewMoney(amount, onlySoon);
      expect(split.buys).toEqual([]);
      expect(split.cashCents).toBe(amount);
    }
  });

  it("sends everything to the furthest goal when nothing needs money", () => {
    const quiet = goalBuckets(
      goals.map((g) => ({ ...g, monthlyCents: 0 })),
      "2026-10-19",
      4,
    );
    expect(splitNewMoney(10_000, quiet).perBucket).toEqual([
      { id: "retirement", amountCents: 10_000 },
    ]);
  });
});
