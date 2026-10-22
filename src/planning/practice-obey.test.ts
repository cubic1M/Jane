import { describe, expect, it } from "vitest";
import type { RiskLevel } from "@/config/investing";
import {
  AUTOPILOT_LIMITS,
  classTickers,
  PRACTICE_ETFS,
  PRACTICE_STOCKS,
  PRACTICE_UNIVERSE,
  type PracticeClass,
} from "@/config/portfolios";
import { APPETITE_ORDER, OPPORTUNITY_HARD_CAPS } from "@/config/practice-preferences";
import type { Bar } from "@/lib/market";
import { SampleMarketData } from "@/lib/market/sample";
import { planTrades, portfolioValue, positionValue } from "./practice-autopilot";
import { apply, type LedgerState } from "./practice-ledger";
import { DEFAULT_PREFERENCES, type PracticePreferences } from "./practice-preferences";
import { profileFor, refusedByPreferences } from "./practice-profile";
import { scanPortfolio, type PastTrade } from "./practice-scan";

// The pure autopilot and scan obey a person's profile (src/planning/practice-profile.ts) on the
// sample market: exclusions are never bought, the cash buffer is kept, the appetite scales the
// extra moves, and the hard limits win over every preference.

const market = new SampleMarketData();
const DAY_MS = 86_400_000;
const daysBefore = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
const prefs = (p: Partial<PracticePreferences> = {}): PracticePreferences => ({
  ...DEFAULT_PREFERENCES,
  avoid: [],
  ...p,
});

async function pricesOn(day: string) {
  const prices: Record<string, number> = {};
  for (const t of PRACTICE_UNIVERSE) {
    const bar = await market.latest(t, day);
    if (bar) prices[t] = bar.closeCents;
  }
  return prices;
}

async function boughtOn(level: RiskLevel, day: string, cashCents = 1_000_000) {
  const prices = await pricesOn(day);
  let state: LedgerState = { cashCents, positions: {} };
  const trades: PastTrade[] = [];
  for (const t of planTrades({ level, state, prices, paused: false, tradesToday: 0 })) {
    const done = apply(state, { ...t, priceCents: prices[t.ticker] }, PRACTICE_UNIVERSE);
    state = done.state;
    trades.push({
      placedAt: `${day}T21:00:00.000Z`,
      side: t.side,
      ticker: t.ticker,
      quantity: done.quantity,
      amountCents: t.amountCents,
      gainCents: done.gainCents,
      rule: t.rule,
    });
  }
  return { state, trades };
}

async function scanWith(
  p: PracticePreferences,
  level: RiskLevel,
  day: string,
  held: { state: LedgerState; trades: PastTrade[] },
) {
  const profile = profileFor(p, { level, today: day });
  const history: Record<string, Bar[]> = {};
  for (const c of Object.keys(PRACTICE_ETFS) as PracticeClass[]) {
    for (const t of classTickers(c)) history[t] = await market.prices(t, daysBefore(day, 50), day);
  }
  return scanPortfolio({
    level: profile.level,
    state: {
      ...held.state,
      cashCents: Math.max(0, held.state.cashCents - profile.cashBufferCents),
    },
    prices: await pricesOn(day),
    history,
    trades: held.trades,
    headlines: await market.news(PRACTICE_STOCKS, daysBefore(day, 2), day),
    today: day,
    opportunitiesPaused: false,
    usedThisMonth: {},
    seen: new Set(),
    weights: profile.weights,
    caps: profile.caps,
    opportunityMaxShare: profile.opportunityMaxShare,
    avoid: profile.avoid,
  });
}

const withCash = (held: { state: LedgerState; trades: PastTrade[] }, cents: number) => ({
  ...held,
  state: { ...held.state, cashCents: held.state.cashCents + cents },
});

describe("the autopilot obeys preferences", () => {
  it("never buys what's on the never-buy list, using the other fund of the kind", async () => {
    const prices = await pricesOn("2026-09-01");
    const profile = profileFor(prefs({ avoid: ["VTI", "BND"] }), { level: 3, today: "2026-09-01" });
    const trades = planTrades({
      level: profile.level,
      state: { cashCents: 1_000_000, positions: {} },
      prices,
      paused: false,
      tradesToday: 0,
      weights: profile.weights,
      avoid: new Set(profile.avoid),
    });
    const bought = trades.filter((t) => t.side === "buy").map((t) => t.ticker);
    expect(bought).toContain("ITOT");
    expect(bought).toContain("AGG");
    expect(bought).not.toContain("VTI");
    expect(bought).not.toContain("BND");
  });

  it("keeps the cash buffer: never spends it, and sells to make it up", async () => {
    const prices = await pricesOn("2026-09-01");
    const fresh = planTrades({
      level: 4,
      state: { cashCents: 1_000_000, positions: {} },
      prices,
      paused: false,
      tradesToday: 0,
      cashBufferCents: 150_000,
    });
    const spent = fresh.reduce((s, t) => s + (t.side === "buy" ? t.amountCents : 0), 0);
    expect(spent).toBeLessThanOrEqual(850_000);

    const { state } = await boughtOn(4, "2026-09-01");
    const raise = planTrades({
      level: 4,
      state,
      prices,
      paused: false,
      tradesToday: 0,
      cashBufferCents: 100_000,
    });
    const sold = raise.filter((t) => t.rule === "cash_buffer");
    expect(sold.reduce((s, t) => s + t.amountCents, 0)).toBeGreaterThanOrEqual(
      100_000 - state.cashCents - AUTOPILOT_LIMITS.minTradeCents,
    );
    expect(raise.filter((t) => t.side === "buy")).toEqual([]);
  });

  it("the hard limits win over a mix the preferences ask for", async () => {
    const prices = await pricesOn("2026-09-01");
    // A goal at hand: the glide path asks for everything in short-term bills.
    const profile = profileFor(prefs({ goalDate: "2026-12-01" }), {
      level: 5,
      today: "2026-09-01",
    });
    expect(profile.weights.cash).toBe(1);
    const trades = planTrades({
      level: profile.level,
      state: { cashCents: 1_000_000, positions: {} },
      prices,
      paused: false,
      tradesToday: 0,
      weights: profile.weights,
    });
    const bil = trades.filter((t) => t.ticker === "BIL").reduce((s, t) => s + t.amountCents, 0);
    expect(bil).toBeGreaterThan(0);
    expect(bil).toBeLessThanOrEqual(Math.round(1_000_000 * AUTOPILOT_LIMITS.perEtfShare));
    expect(trades.length).toBeLessThanOrEqual(AUTOPILOT_LIMITS.tradesPerDay);
  });

  it("the last check refuses every order in suggest only, and buys of anything avoided", () => {
    const suggest = profileFor(prefs({ mode: "suggest" }), { level: 3, today: "2026-09-01" });
    expect(refusedByPreferences(suggest, { ticker: "VTI", side: "buy" })).toBe("suggest only");
    expect(refusedByPreferences(suggest, { ticker: "VTI", side: "sell" })).toBe("suggest only");
    const act = profileFor(prefs({ avoid: ["cars"] }), { level: 5, today: "2026-09-01" });
    expect(refusedByPreferences(act, { ticker: "tsla", side: "buy" })).not.toBeNull();
    expect(refusedByPreferences(act, { ticker: "TSLA", side: "sell" })).toBeNull();
    expect(refusedByPreferences(act, { ticker: "VTI", side: "buy" })).toBeNull();
  });
});

describe("the daily scan obeys preferences", () => {
  it("takes no news idea in an avoided company, and none at all with tech avoided", async () => {
    const held = withCash(await boughtOn(5, "2026-09-01"), 50_000);
    const usual = await scanWith(prefs(), 5, "2026-10-09", held);
    expect(usual.some((f) => f.kind === "news_idea" && f.ticker === "NVDA")).toBe(true);
    const flags = await scanWith(prefs({ avoid: ["NVDA"] }), 5, "2026-10-09", held);
    expect(flags.some((f) => f.trades.some((t) => t.side === "buy" && t.ticker === "NVDA"))).toBe(
      false,
    );
    const tech = await scanWith(prefs({ avoid: ["tech"] }), 5, "2026-10-09", held);
    expect(tech.some((f) => f.kind === "news_idea")).toBe(false);
  });

  it("doesn't harvest into an avoided fund, or at all with harvesting off", async () => {
    const held = withCash(await boughtOn(4, "2026-09-01"), 50_000);
    const usual = await scanWith(prefs(), 4, "2026-10-14", held);
    expect(usual.some((f) => f.kind === "tax_loss_harvest" && f.ticker === "VTI")).toBe(true);
    const noItot = await scanWith(prefs({ avoid: ["ITOT"] }), 4, "2026-10-14", held);
    expect(noItot.some((f) => f.trades.some((t) => t.side === "buy" && t.ticker === "ITOT"))).toBe(
      false,
    );
    const off = await scanWith(prefs({ harvestLosses: false }), 4, "2026-10-14", held);
    expect(off.some((f) => f.kind === "tax_loss_harvest")).toBe(false);
  });

  it("scales the dip buy with the appetite, never past its hard cap", async () => {
    const held = withCash(await boughtOn(4, "2026-09-01"), 300_000);
    const total = portfolioValue(held.state, await pricesOn("2026-10-14"));
    const sizes: number[] = [];
    for (const appetite of APPETITE_ORDER) {
      const flags = await scanWith(prefs({ appetite }), 4, "2026-10-14", held);
      const dips = flags.filter((f) => f.kind === "dip_buy");
      if (appetite === "off") expect(dips).toEqual([]);
      for (const d of dips) {
        expect(d.amountCents).toBeLessThanOrEqual(
          Math.round(OPPORTUNITY_HARD_CAPS.dip_buy!.sizeShare * total),
        );
      }
      sizes.push(dips.reduce((s, d) => s + d.amountCents, 0));
    }
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    expect(sizes.at(-1)!).toBeGreaterThan(sizes[1]);
  });

  it("never spends the cash buffer on a dip", async () => {
    const held = withCash(await boughtOn(4, "2026-09-01"), 60_000);
    const cash = held.state.cashCents;
    const flags = await scanWith(prefs({ cashBufferCents: cash }), 4, "2026-10-14", held);
    expect(flags.filter((f) => f.kind === "dip_buy")).toEqual([]);
    // The position cap: no news idea leaves a company over the per-stock hard cap.
    const ideas = await scanWith(prefs({ appetite: "adventurous" }), 5, "2026-10-09", held);
    const prices = await pricesOn("2026-10-09");
    for (const f of ideas.filter((x) => x.kind === "news_idea")) {
      const own = positionValue(held.state, prices, f.ticker);
      expect(own + f.amountCents).toBeLessThanOrEqual(
        Math.round(portfolioValue(held.state, prices) * AUTOPILOT_LIMITS.perStockShare),
      );
    }
  });
});
