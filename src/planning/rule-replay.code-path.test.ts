import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// The rule replay has no rules of its own: it calls the live scan's and autopilot's functions
// (the same ones src/lib/practice/scan.ts and autopilot.ts call), and the live hard limits bind
// it. Here the limits are tightened and the functions watched.

vi.mock("@/config/portfolios", async (original) => {
  const actual = await original<typeof import("@/config/portfolios")>();
  return {
    ...actual,
    AUTOPILOT_LIMITS: { ...actual.AUTOPILOT_LIMITS, tradesPerDay: 3, perTradeShare: 0.3 },
  };
});
vi.mock("./practice-scan", async (original) => {
  const actual = await original<typeof import("./practice-scan")>();
  return {
    ...actual,
    scanPortfolio: vi.fn(actual.scanPortfolio),
    flagStatus: vi.fn(actual.flagStatus),
    monthUse: vi.fn(actual.monthUse),
    washBlocked: vi.fn(actual.washBlocked),
  };
});
vi.mock("./practice-opportunities", async (original) => {
  const actual = await original<typeof import("./practice-opportunities")>();
  return { ...actual, scanOpportunities: vi.fn(actual.scanOpportunities) };
});
vi.mock("./practice-autopilot", async (original) => {
  const actual = await original<typeof import("./practice-autopilot")>();
  return {
    ...actual,
    planTrades: vi.fn(actual.planTrades),
    monthlyDue: vi.fn(actual.monthlyDue),
    sellsFirst: vi.fn(actual.sellsFirst),
  };
});

import { PRACTICE_STOCKS, PRACTICE_UNIVERSE } from "@/config/portfolios";
import { SCAN_KINDS } from "@/config/practice-scan";
import { SAMPLE_START, SampleMarketData } from "@/lib/market/sample";
import type { Bar } from "@/lib/market/types";
import { monthlyDue, planTrades, sellsFirst } from "./practice-autopilot";
import { scanOpportunities } from "./practice-opportunities";
import { flagStatus, monthUse, scanPortfolio, washBlocked } from "./practice-scan";
import { replayRules } from "./rule-replay";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("the rule replay's code path", () => {
  it("calls the live scan's and autopilot's own functions every day", async () => {
    const market = new SampleMarketData();
    const bars: Record<string, Bar[]> = {};
    for (const t of PRACTICE_UNIVERSE) bars[t] = await market.prices(t, SAMPLE_START, "2020-12-31");
    const r = replayRules({
      level: 5,
      bars,
      headlines: await market.news(PRACTICE_STOCKS, SAMPLE_START, "2020-12-31"),
      startCents: 1_000_000,
      monthlyAddCents: 50_000,
      addDay: 1,
      strategy: "rules",
      rules: new Set(SCAN_KINDS),
      tradeCostBps: 0,
    })!;
    const days = r.index.length;
    expect(vi.mocked(scanOpportunities)).toHaveBeenCalledTimes(days);
    expect(vi.mocked(scanPortfolio)).toHaveBeenCalledTimes(days);
    expect(vi.mocked(planTrades)).toHaveBeenCalledTimes(days);
    expect(vi.mocked(monthUse)).toHaveBeenCalledTimes(days);
    expect(vi.mocked(monthlyDue)).toHaveBeenCalledTimes(days);
    expect(vi.mocked(sellsFirst)).toHaveBeenCalledTimes(days);
    expect(vi.mocked(washBlocked)).toHaveBeenCalled();
    expect(vi.mocked(flagStatus)).toHaveBeenCalled();

    // The tightened live limits bind the replay too.
    expect(r.maxTradesInADay).toBeLessThanOrEqual(3);
    for (const t of r.trades) expect(t.amountCents).toBeLessThanOrEqual(0.3 * t.portfolioCents + 2);
  });

  it("holds no rule of its own: no threshold, and the live run calls the same functions", () => {
    const replay = source("./rule-replay.ts");
    for (const rule of [
      "DIP_MIN_DROP",
      "DIP_MAX_OVER_TARGET",
      "HARVEST_MIN_LOSS_SHARE",
      "HARVEST_MIN_LOSS_CENTS",
      "NEWS_GOOD",
      "NEWS_BAD",
      "SCAN_CAPS",
      "OPPORTUNITY_MAX_SHARE",
      "rebalanceBand",
      "perTradeShare",
      "tradesPerDay",
    ])
      expect(replay).not.toContain(rule);
    const scan = source("../lib/practice/scan.ts");
    for (const fn of ["scanOpportunities", "flagStatus", "monthUse", "notAskedYet"]) {
      expect(scan).toContain(`${fn}(`);
      expect(replay).toContain(`${fn}(`);
    }
    const autopilot = source("../lib/practice/autopilot.ts");
    for (const fn of ["planTrades", "sellsFirst", "monthlyDue", "washBlocked"])
      expect(autopilot).toContain(`${fn}(`);
  });
});
