import { describe, expect, it } from "vitest";
import { AUTOPILOT_LIMITS, PRACTICE_STOCKS, PRACTICE_UNIVERSE } from "@/config/portfolios";
import {
  OPPORTUNITY_MAX_SHARE,
  SCAN_CAPS,
  SCAN_KINDS,
  type ScanKind,
} from "@/config/practice-scan";
import type { Bar } from "@/lib/market/types";
import { SAMPLE_START, SampleMarketData } from "@/lib/market/sample";
import { replayDays, replayRules, ruleEffect, stressDrop, type ReplayInput } from "./rule-replay";

// The rule replay: the autopilot and the daily scan's own rules run day by day over history.
// A hand-worked case with a planted dip; every cap holds; the same bars give the same result.

const series = (pairs: [string, number][]): Bar[] =>
  pairs.map(([date, dollars]) => ({ date, closeCents: dollars * 100 }));
const DAYS = ["2025-01-02", "2025-01-03", "2025-02-03", "2025-02-04"];
const flat = (dollars = 100) => series(DAYS.map((d) => [d, dollars]));

const base = (bars: Record<string, readonly Bar[]>): ReplayInput => ({
  level: 1,
  bars,
  headlines: [],
  startCents: 1_000_000,
  monthlyAddCents: 50_000,
  addDay: 1,
  strategy: "rules",
  rules: new Set<ScanKind>(["drift_rebalance", "dip_buy"]),
  tradeCostBps: 0,
});

describe("replayRules: a planted dip, worked by hand", () => {
  // Very low (20% US stocks, 10% international, 60% bonds, 10% bills), $10,000 to start and $500
  // on the first trading day of each month. Every fund is $100 throughout except:
  //   VTI:  $100, $100, then $80 on Feb 3 (the planted dip), back to $100 on Feb 4.
  //   ITOT: $50, $50, $40, $50 (VTI's swap partner, moving with it).
  // Jan 2: $10,000 + $500 in. The autopilot buys the model: VTI $2,100, VXUS $1,050, BND $6,300,
  //   BIL $1,050. No cash left.
  // Feb 3: $500 in. Worth $1,680 + $1,050 + $6,300 + $1,050 + $500 = $10,580. VTI is 20% below its
  //   high of the days before: a dip. VTI is held at a loss, so the dip buy goes into ITOT (a
  //   wash sale otherwise later): the smallest of the cash ($500), 5% of $10,580 ($529) and the
  //   room to 25% in US stocks ($2,645 − $1,680 = $965) is $500, 12.5 ITOT. Mix inside the band.
  // Feb 4: worth $2,100 + $625 + $1,050 + $6,300 + $1,050 = $11,125.
  // Time-weighted: $10,000; then ×(10,580 − 500)/10,500 = $9,600; then ×11,125/10,580
  //   = $10,094.52. Return +0.945%. $11,000 put in.
  const bars = {
    VTI: series([
      ["2025-01-02", 100],
      ["2025-01-03", 100],
      ["2025-02-03", 80],
      ["2025-02-04", 100],
    ]),
    ITOT: series([
      ["2025-01-02", 50],
      ["2025-01-03", 50],
      ["2025-02-03", 40],
      ["2025-02-04", 50],
    ]),
    VXUS: flat(),
    BND: flat(),
    BIL: flat(),
  };

  it("buys the dip with the month's cash, into the swap partner, and nothing else", () => {
    const r = replayRules(base(bars))!;
    expect(r.trades.map((t) => [t.date, t.ticker, t.side, t.amountCents, t.rule])).toEqual([
      ["2025-01-02", "VTI", "buy", 210_000, "model_buy"],
      ["2025-01-02", "VXUS", "buy", 105_000, "model_buy"],
      ["2025-01-02", "BND", "buy", 630_000, "model_buy"],
      ["2025-01-02", "BIL", "buy", 105_000, "model_buy"],
      ["2025-02-03", "ITOT", "buy", 50_000, "dip_buy"],
    ]);
    expect(r.trades[4].quantity).toBe(12.5);
    expect(r.trades[4].reason).toMatch(/VTI is 20% below its high/);
    expect(r.acted).toEqual({ dip_buy: 1 });
    expect(r.held).toEqual({});
    expect(r.putInCents).toBe(1_100_000);
    expect(r.endCents).toBe(1_112_500);
    expect(r.index.map((p) => p.valueCents)).toEqual([1_000_000, 1_000_000, 960_000, 1_009_452]);
    expect(r.totalReturn).toBeCloseTo(0.009452, 6);
    expect(r.worstDrop.fraction).toBeCloseTo(-0.04, 10);
    expect(r.worstDrop.troughDate).toBe("2025-02-03");
    expect(r.worstDrop.recoveredOn).toBe("2025-02-04");
  });

  it("does nothing on the dip without the dip rule: the month's cash waits for the autopilot", () => {
    const r = replayRules({ ...base(bars), rules: new Set(["drift_rebalance"]) })!;
    expect(r.trades.some((t) => t.rule === "dip_buy")).toBe(false);
    expect(r.acted).toEqual({});
  });

  it("takes each trade's cost off the value", () => {
    const r = replayRules({ ...base(bars), tradeCostBps: 10 })!;
    // $11,000 changed hands at 0.1%: $11.
    expect(r.costCents).toBe(1_100);
    expect(r.endCents).toBe(1_112_500 - 1_100);
  });

  it("buys and holds: the targets with each month's money, never a sale", () => {
    const r = replayRules({ ...base(bars), strategy: "hold" })!;
    expect(r.trades.every((t) => t.side === "buy" && t.rule === "hold")).toBe(true);
    expect(r.trades.filter((t) => t.date === "2025-02-03").map((t) => t.amountCents)).toEqual([
      10_000, 5_000, 30_000, 5_000,
    ]);
  });

  it("needs at least two days every model fund shares", () => {
    expect(replayRules(base({ VTI: flat(), VXUS: flat(), BND: flat() }))).toBeNull();
    expect(replayDays(bars)).toEqual(DAYS);
  });
});

describe("replayRules on the sample market", () => {
  const market = new SampleMarketData();
  const load = async (to: string) => {
    const bars: Record<string, Bar[]> = {};
    for (const t of PRACTICE_UNIVERSE) bars[t] = await market.prices(t, SAMPLE_START, to);
    return { bars, headlines: await market.news(PRACTICE_STOCKS, SAMPLE_START, to) };
  };
  const all = new Set(SCAN_KINDS);

  it("keeps every cap: per trade, per holding, trades a day and the opportunity share", async () => {
    const { bars, headlines } = await load("2026-10-30");
    for (const level of [1, 3, 5] as const) {
      const r = replayRules({ ...base(bars), level, headlines, rules: all, tradeCostBps: 2 })!;
      expect(r.trades.length).toBeGreaterThan(50);
      expect(r.maxTradesInADay).toBeLessThanOrEqual(AUTOPILOT_LIMITS.tradesPerDay);
      for (const t of r.trades) {
        const cap = (share: number) => Math.round(share * t.portfolioCents) + 2;
        expect(t.amountCents).toBeLessThanOrEqual(cap(AUTOPILOT_LIMITS.perTradeShare));
        if (t.side !== "buy") continue;
        const stock = (PRACTICE_STOCKS as readonly string[]).includes(t.ticker);
        const position = stock ? AUTOPILOT_LIMITS.perStockShare : AUTOPILOT_LIMITS.perEtfShare;
        expect(t.positionAfterCents).toBeLessThanOrEqual(cap(position));
        if (t.rule === "dip_buy")
          expect(t.amountCents).toBeLessThanOrEqual(cap(SCAN_CAPS.dip_buy.sizeShare));
        if (t.rule === "news_idea" && stock)
          expect(t.amountCents).toBeLessThanOrEqual(cap(SCAN_CAPS.news_idea.sizeShare));
      }
      expect(r.maxOpportunityShare).toBeLessThanOrEqual(OPPORTUNITY_MAX_SHARE + 1e-4);
      // Each kind acts at most its monthly count.
      const perMonth = new Map<string, number>();
      for (const t of r.trades.filter((x) => x.rule === "dip_buy")) {
        const k = t.date.slice(0, 7);
        perMonth.set(k, (perMonth.get(k) ?? 0) + 1);
      }
      for (const n of perMonth.values()) expect(n).toBeLessThanOrEqual(SCAN_CAPS.dip_buy.perMonth);
    }
  });

  it("brings news ideas at Very high only, never below High", async () => {
    const { bars, headlines } = await load("2026-10-30");
    const high = replayRules({ ...base(bars), level: 5, headlines, rules: all })!;
    const low = replayRules({ ...base(bars), level: 3, headlines, rules: all })!;
    expect(high.acted.news_idea).toBeGreaterThan(0);
    expect(low.acted.news_idea).toBeUndefined();
  });

  it("gives the same result for the same bars", async () => {
    const { bars, headlines } = await load("2023-12-29");
    const input = { ...base(bars), level: 4 as const, headlines, rules: all, tradeCostBps: 2 };
    expect(replayRules(input)).toEqual(replayRules(input));
  });

  it("reports the 2020 and 2022 drops, and none for a period it doesn't cover", async () => {
    const { bars } = await load("2026-10-30");
    const r = replayRules({ ...base(bars), level: 5, rules: all })!;
    const d2020 = stressDrop(r.index, { label: "2020", from: "2020-01-01", to: "2020-12-31" });
    expect(d2020.fraction).toBeLessThan(-0.2);
    const before = stressDrop(r.index, { label: "2016", from: "2016-01-01", to: "2016-12-31" });
    expect(before.fraction).toBeNull();
  });
});

describe("ruleEffect", () => {
  const at = (totalReturn: number, fraction: number) => ({
    totalReturn,
    worstDrop: { fraction } as { fraction: number } & Record<string, never>,
  });
  it("calls a rule worse past the margin, better past it, else no difference", () => {
    expect(ruleEffect(at(0.5, -0.3), at(0.51, -0.3), 0.25).effect).toBe("hurt");
    expect(ruleEffect(at(0.51, -0.3), at(0.5, -0.3), 0.25).effect).toBe("helped");
    expect(ruleEffect(at(0.501, -0.3), at(0.5, -0.3), 0.25).effect).toBe("no_difference");
    // A deeper drop with no better return is worse.
    expect(ruleEffect(at(0.5, -0.31), at(0.5, -0.3), 0.25).effect).toBe("hurt");
    expect(ruleEffect(at(0.5, -0.3), at(0.5, -0.31), 0.25)).toMatchObject({
      effect: "helped",
      returnPoints: 0,
    });
  });
});
