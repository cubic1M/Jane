import { describe, expect, it } from "vitest";
import type { RiskLevel } from "@/config/investing";
import {
  classTickers,
  OPPORTUNITY_LEVELS,
  PRACTICE_ETFS,
  PRACTICE_STOCKS,
  PRACTICE_UNIVERSE,
  type PracticeClass,
} from "@/config/portfolios";
import {
  OPPORTUNITY_RULES_OFF,
  rulesOnAt,
  SCAN_CAPS,
  SCAN_KINDS,
  type ScanKind,
} from "@/config/practice-scan";
import type { Bar } from "@/lib/market";
import { SAMPLE_EVENTS, SampleMarketData } from "@/lib/market/sample";
import { planTrades, portfolioValue } from "./practice-autopilot";
import { apply, type LedgerState } from "./practice-ledger";
import { drift, scanPortfolio, washBlocked, type PastTrade, type ScanInput } from "./practice-scan";

// Spec step 292: each flag fires on the sample market's planted event and not otherwise;
// opportunities never appear below High; the caps hold.

const market = new SampleMarketData();
const DAY_MS = 86_400_000;
const daysBefore = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
const inEvent = (day: string) => SAMPLE_EVENTS.some((e) => day >= e.from && day <= e.to);

async function pricesOn(day: string) {
  const prices: Record<string, number> = {};
  for (const t of PRACTICE_UNIVERSE) {
    const bar = await market.latest(t, day);
    if (bar) prices[t] = bar.closeCents;
  }
  return prices;
}

async function historyTo(day: string) {
  const history: Record<string, Bar[]> = {};
  for (const c of Object.keys(PRACTICE_ETFS) as PracticeClass[]) {
    for (const t of classTickers(c)) history[t] = await market.prices(t, daysBefore(day, 50), day);
  }
  return history;
}

// The model for a level bought with practice money on a day, as the autopilot would.
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

// Every rule, whatever OPPORTUNITY_RULES_OFF turns off at a level: these tests are about the
// rules themselves (the switch has its own test below).
async function scanOn(
  level: RiskLevel,
  day: string,
  held: { state: LedgerState; trades: PastTrade[] },
  extra: Partial<ScanInput> = {},
) {
  return scanPortfolio({
    rules: new Set(SCAN_KINDS),
    level,
    state: held.state,
    prices: await pricesOn(day),
    history: await historyTo(day),
    trades: held.trades,
    headlines: await market.news(PRACTICE_STOCKS, daysBefore(day, 2), day),
    today: day,
    opportunitiesPaused: false,
    usedThisMonth: {},
    seen: new Set(),
    ...extra,
  });
}

const kinds = (flags: { kind: ScanKind }[]) => flags.map((f) => f.kind);
const withCash = (held: { state: LedgerState; trades: PastTrade[] }, cents: number) => ({
  ...held,
  state: { ...held.state, cashCents: held.state.cashCents + cents },
});

async function tradingDays(from: string, to: string) {
  return (await market.prices("VTI", from, to)).map((b) => b.date);
}

describe("the daily scan: drift-rebalance", () => {
  it("fires when the 2020 shock pulls the mix past the band", async () => {
    const held = await boughtOn(3, "2020-02-18");
    const flags = await scanOn(3, "2020-03-23", held);
    const flag = flags.find((f) => f.kind === "drift_rebalance");
    expect(flag).toBeDefined();
    expect(flag!.trades).toEqual([]);
    expect(flag!.reason).toMatch(/Stocks are .* against 60%/);
  });

  it("doesn't fire while prices are calm", async () => {
    const held = await boughtOn(3, "2026-01-02");
    for (const day of await tradingDays("2026-01-02", "2026-10-08")) {
      if (inEvent(day)) continue;
      const d = drift(3, held.state, await pricesOn(day));
      expect(d.past, day).toBe(false);
    }
    expect(kinds(await scanOn(3, "2026-10-08", held))).not.toContain("drift_rebalance");
  });
});

describe("the daily scan: dip-buy within the plan", () => {
  it("fires in this autumn's dip, with the cash waiting and within the caps", async () => {
    const held = withCash(await boughtOn(3, "2026-09-01"), 50_000);
    const flags = (await scanOn(3, "2026-10-14", held)).filter((f) => f.kind === "dip_buy");
    expect(flags.map((f) => f.ticker)).toContain("VTI");
    const total = portfolioValue(held.state, await pricesOn("2026-10-14"));
    const spent = flags.reduce((s, f) => s + f.amountCents, 0);
    expect(spent).toBeLessThanOrEqual(50_000);
    for (const f of flags) {
      expect(f.amountCents).toBeLessThanOrEqual(Math.round(SCAN_CAPS.dip_buy.sizeShare * total));
      expect(f.trades).toEqual([expect.objectContaining({ side: "buy", rule: "dip_buy" })]);
    }
  });

  it("buys only with cash the plan allows: none waiting, no dip buy", async () => {
    const held = await boughtOn(3, "2026-09-01");
    expect(held.state.cashCents).toBeLessThan(1_000);
    expect(kinds(await scanOn(3, "2026-10-14", held))).not.toContain("dip_buy");
  });

  it("doesn't fire on any ordinary day of 2026", async () => {
    const held = withCash(await boughtOn(3, "2026-01-02"), 50_000);
    for (const day of await tradingDays("2026-02-02", "2026-12-31")) {
      if (inEvent(day)) continue;
      const flags = await scanOn(3, day, held);
      expect(kinds(flags), day).not.toContain("dip_buy");
    }
  });
});

describe("the daily scan: tax-loss harvest without a wash sale", () => {
  it("swaps a fund at a loss into a similar fund of the same kind in this autumn's dip", async () => {
    const held = await boughtOn(3, "2026-09-01");
    const flags = (await scanOn(3, "2026-10-14", held)).filter(
      (f) => f.kind === "tax_loss_harvest",
    );
    const vti = flags.find((f) => f.ticker === "VTI");
    expect(vti).toBeDefined();
    expect(vti!.trades).toEqual([
      expect.objectContaining({ ticker: "VTI", side: "sell" }),
      expect.objectContaining({ ticker: "ITOT", side: "buy" }),
    ]);
    // Same amount out and in: the mix stays the same.
    expect(vti!.trades[0].amountCents).toBe(vti!.trades[1].amountCents);
    // Short-term bills and bonds hardly move: nothing worth harvesting there.
    expect(flags.map((f) => f.ticker)).not.toContain("BIL");
    expect(flags.map((f) => f.ticker)).not.toContain("BND");
  });

  it("doesn't fire before the dip", async () => {
    const held = await boughtOn(3, "2026-09-01");
    expect(kinds(await scanOn(3, "2026-10-08", held))).not.toContain("tax_loss_harvest");
  });

  it("never makes a wash sale: not after a recent buy, not into a fund just sold at a loss", async () => {
    // Bought 29 days before: selling at a loss now would be a wash sale.
    const recent = await boughtOn(3, "2026-09-15");
    const flags = await scanOn(3, "2026-10-14", recent);
    expect(flags.filter((f) => f.kind === "tax_loss_harvest").map((f) => f.ticker)).toEqual([]);

    // ITOT sold at a loss last week: VTI can't be swapped into it.
    const held = await boughtOn(3, "2026-09-01");
    const sold: PastTrade = {
      placedAt: "2026-10-07T21:00:00.000Z",
      side: "sell",
      ticker: "ITOT",
      quantity: 1,
      amountCents: 6_000,
      gainCents: -500,
      rule: "tax_loss_harvest",
    };
    expect(washBlocked([sold], "2026-10-14")).toEqual(new Set(["ITOT"]));
    const after = await scanOn(3, "2026-10-14", { ...held, trades: [...held.trades, sold] });
    expect(after.some((f) => f.kind === "tax_loss_harvest" && f.ticker === "VTI")).toBe(false);
  });
});

describe("the daily scan: news-driven ideas", () => {
  it("fires on the planted good news at High and Very high, small and capped", async () => {
    for (const level of OPPORTUNITY_LEVELS) {
      const held = withCash(await boughtOn(level, "2026-09-01"), 50_000);
      const total = portfolioValue(held.state, await pricesOn("2026-10-09"));
      const flags = (await scanOn(level, "2026-10-09", held)).filter((f) => f.kind === "news_idea");
      expect(flags.map((f) => f.ticker)).toEqual(["NVDA"]);
      expect(flags[0].amountCents).toBeLessThanOrEqual(
        Math.round(SCAN_CAPS.news_idea.sizeShare * total),
      );
      expect(flags[0].confidence.percent).toBeLessThan(50);
      const later = await scanOn(level, "2026-10-16", held);
      expect(later.filter((f) => f.kind === "news_idea").map((f) => f.ticker)).toEqual(["MSFT"]);
    }
  });

  it("pays for an idea from the short-term bills when no cash is waiting", async () => {
    const held = await boughtOn(4, "2026-09-01");
    expect(held.state.cashCents).toBeLessThan(1_000);
    const [idea] = (await scanOn(4, "2026-10-09", held)).filter((f) => f.kind === "news_idea");
    expect(idea.trades).toEqual([
      expect.objectContaining({ ticker: "BIL", side: "sell" }),
      expect.objectContaining({ ticker: "NVDA", side: "buy" }),
    ]);
  });

  it("never fires below High, while opportunities are paused, on bad news or with no news", async () => {
    for (const level of [1, 2, 3] as const) {
      const held = withCash(await boughtOn(level, "2026-09-01"), 50_000);
      for (const day of ["2026-10-09", "2026-10-16", "2026-03-05"]) {
        expect(kinds(await scanOn(level, day, held))).not.toContain("news_idea");
      }
    }
    const high = withCash(await boughtOn(4, "2026-09-01"), 50_000);
    const paused = await scanOn(4, "2026-10-09", high, { opportunitiesPaused: true });
    expect(kinds(paused)).not.toContain("news_idea");
    // A recall (TSLA) and a cut outlook (AAPL) aren't good news; nothing new by the 22nd.
    for (const day of ["2026-10-15", "2026-10-22"]) {
      expect(kinds(await scanOn(4, day, high))).not.toContain("news_idea");
    }
  });
});

describe("the daily scan: the ledger", () => {
  it("places every flag's trades in the practice ledger as they stand, selling no more than is held", async () => {
    for (const level of [3, 4, 5] as const) {
      const held = withCash(await boughtOn(level, "2026-09-01"), 50_000);
      for (const day of ["2026-10-09", "2026-10-14", "2026-10-16"]) {
        const prices = await pricesOn(day);
        let state = held.state;
        for (const f of await scanOn(level, day, held)) {
          for (const t of f.trades) {
            const entry = { ...t, priceCents: prices[t.ticker] };
            state = apply(state, entry, PRACTICE_UNIVERSE).state;
          }
        }
        expect(state.cashCents).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("the daily scan: caps", () => {
  it("holds the monthly count cap and never acts on the same event twice", async () => {
    const held = withCash(await boughtOn(4, "2026-09-01"), 50_000);
    const all = await scanOn(4, "2026-10-14", held);
    expect(all.length).toBeGreaterThan(0);
    const full = Object.fromEntries(SCAN_KINDS.map((k) => [k, SCAN_CAPS[k].perMonth]));
    expect(await scanOn(4, "2026-10-14", held, { usedThisMonth: full })).toEqual([]);
    const seen = new Set(all.map((f) => f.key));
    expect(await scanOn(4, "2026-10-14", held, { seen })).toEqual([]);
  });

  it("gives every flag a rule, numbers, caps and a confidence with its reason", async () => {
    const held = withCash(await boughtOn(4, "2026-09-01"), 50_000);
    const flags = [
      ...(await scanOn(4, "2026-10-09", held)),
      ...(await scanOn(4, "2026-10-14", held)),
      ...(await scanOn(3, "2020-03-23", await boughtOn(3, "2020-02-18"))),
    ];
    expect(new Set(kinds(flags))).toEqual(
      new Set(["drift_rebalance", "dip_buy", "tax_loss_harvest", "news_idea"]),
    );
    for (const f of flags) {
      expect(f.reason.length).toBeGreaterThan(30);
      expect(f.figures.length).toBeGreaterThan(0);
      expect(f.caps.length).toBeGreaterThan(0);
      expect(f.confidence.percent).toBeGreaterThan(0);
      expect(f.confidence.percent).toBeLessThan(100);
      expect(f.confidence.reason.length).toBeGreaterThan(20);
      expect(f.trades.every((t) => t.rule === f.kind)).toBe(true);
    }
  });
});

describe("the daily scan: rules turned off by the rule replay", () => {
  it("keeps drift on everywhere and every turned-off rule off at its level, with its evidence", () => {
    for (const level of [1, 2, 3, 4, 5] as const) {
      const on = rulesOnAt(level);
      expect(on.has("drift_rebalance")).toBe(true);
      for (const off of OPPORTUNITY_RULES_OFF[level] ?? []) {
        expect(on.has(off.rule)).toBe(false);
        expect(off.evidence).toMatch(/real history from .* to .*points/);
      }
    }
  });

  it("doesn't harvest at a level where the replay turned harvesting off, by default", async () => {
    const off = ([1, 2, 3, 4, 5] as const).find((l) => !rulesOnAt(l).has("tax_loss_harvest"));
    expect(off).toBeDefined();
    const held = await boughtOn(off!, "2026-09-01");
    const day = "2026-10-14";
    expect(kinds(await scanOn(off!, day, held))).toContain("tax_loss_harvest");
    expect(kinds(await scanOn(off!, day, held, { rules: undefined }))).not.toContain(
      "tax_loss_harvest",
    );
  });
});
