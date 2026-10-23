import { describe, expect, it } from "vitest";
import type { RiskLevel } from "@/config/investing";
import {
  classTickers,
  MODEL_PORTFOLIOS,
  PRACTICE_ETFS,
  PRACTICE_STOCKS,
  PRACTICE_UNIVERSE,
  type PracticeClass,
} from "@/config/portfolios";
import {
  DEFAULT_SCAN_PREFERENCES,
  addDayAfter,
  heldDrop,
  levelWithin,
  mainPaydayDay,
  scanOpportunities,
  type OpportunityInput,
  type ScanPreferences,
} from "./practice-opportunities";
import { OPPORTUNITY_KINDS, SAFETY_KINDS } from "@/config/practice-opportunities";
import { LEVEL_WORST_DROP_PERCENT } from "@/config/practice-preferences";
import { SCAN_CAPS, SCAN_KINDS, type ScanKind } from "@/config/practice-scan";
import type { Suggestion } from "@/detectors/contract";
import { shortFormProblems } from "@/detectors/harness";
import type { Bar } from "@/lib/market";
import { SampleMarketData } from "@/lib/market/sample";
import { planTrades, portfolioValue, positionValue } from "./practice-autopilot";
import { apply, type LedgerState } from "./practice-ledger";
import { glideWeights, levelForDrop } from "./practice-profile";
import { drift, scanPortfolio, type PastTrade } from "./practice-scan";

// The kinds after step 292: each fires on a planted case and not otherwise, the caps hold, the
// person's preferences are obeyed, and the safety kinds never trade.

const market = new SampleMarketData();
const DAY_MS = 86_400_000;
const daysBefore = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

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
    for (const t of classTickers(c)) history[t] = await market.prices(t, daysBefore(day, 90), day);
  }
  return history;
}

type Held = { state: LedgerState; trades: PastTrade[] };

async function boughtOn(level: RiskLevel, day: string, cashCents = 1_000_000): Promise<Held> {
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

// Moves `amountCents` from one fund to another on a day, as a trade would.
async function move(held: Held, day: string, from: string, to: string, amountCents: number) {
  const prices = await pricesOn(day);
  let state = held.state;
  const trades = [...held.trades];
  for (const [ticker, side] of [
    [from, "sell"],
    [to, "buy"],
  ] as const) {
    const done = apply(
      state,
      { side, ticker, amountCents, priceCents: prices[ticker] },
      PRACTICE_UNIVERSE,
    );
    state = done.state;
    trades.push({
      placedAt: `${day}T21:00:00.000Z`,
      side,
      ticker,
      quantity: done.quantity,
      amountCents,
      gainCents: done.gainCents,
      rule: "test",
    });
  }
  return { state, trades };
}

const withCash = (held: Held, cents: number): Held => ({
  ...held,
  state: { ...held.state, cashCents: held.state.cashCents + cents },
});

// Every rule, whatever OPPORTUNITY_RULES_OFF turns off at a level: these tests are about the
// rules themselves (the switch has its own tests in ./practice-scan.test.ts).
async function scanOn(
  level: RiskLevel,
  day: string,
  held: Held,
  extra: Partial<OpportunityInput> = {},
  prefs: Partial<ScanPreferences> = {},
) {
  return scanOpportunities({
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
    monthlyAddCents: 50_000,
    addDay: 1,
    paydayDay: null,
    rules: new Set(SCAN_KINDS),
    ...extra,
    prefs: { ...DEFAULT_SCAN_PREFERENCES, ...prefs },
  });
}

// The suggestion's short forms (docs/detectors.md), and about eight words for the card.
function expectShortForms(f: {
  kind: ScanKind;
  ask: { headline: string; short: string; worthCents: number };
}) {
  expect(shortFormProblems(f.ask as unknown as Suggestion), f.kind).toEqual([]);
  expect(f.ask.headline.split(" ").length, f.ask.headline).toBeLessThanOrEqual(9);
}

const kinds = (flags: { kind: ScanKind }[]) => flags.map((f) => f.kind);
const one = <F extends { kind: ScanKind }>(flags: F[], kind: ScanKind) =>
  flags.filter((f) => f.kind === kind);

describe("rebalance through new money instead of selling", () => {
  it("buys what is short with the cash waiting in the 2020 shock, and never sells", async () => {
    const held = withCash(await boughtOn(3, "2020-02-18"), 100_000);
    const prices = await pricesOn("2020-03-23");
    const flags = await scanOn(3, "2020-03-23", held);
    const [flag] = one(flags, "new_money_rebalance");
    expect(flag).toBeDefined();
    expect(flag.trades.length).toBeGreaterThan(0);
    expect(flag.trades.every((t) => t.side === "buy" && t.rule === "new_money_rebalance")).toBe(
      true,
    );
    expect(flag.amountCents).toBeLessThanOrEqual(100_000);
    const total = portfolioValue(held.state, prices);
    expect(flag.amountCents).toBeLessThanOrEqual(
      Math.round(SCAN_CAPS.new_money_rebalance.sizeShare * total),
    );
    // Only what is short gets bought: stocks fell, so stocks.
    expect(flag.trades.map((t) => t.ticker)).not.toContain("BND");
    // The drift flag stays only if the new money didn't bring the mix back.
    let after = held.state;
    for (const t of flag.trades) {
      after = apply(after, { ...t, priceCents: prices[t.ticker] }, PRACTICE_UNIVERSE).state;
    }
    expect(kinds(flags).includes("drift_rebalance")).toBe(drift(3, after, prices).past);
  });

  it("leaves it to the autopilot when no cash is waiting, or all of it is the buffer", async () => {
    const held = await boughtOn(3, "2020-02-18");
    const flags = await scanOn(3, "2020-03-23", held);
    expect(kinds(flags)).toContain("drift_rebalance");
    expect(kinds(flags)).not.toContain("new_money_rebalance");
    const buffered = await scanOn(
      3,
      "2020-03-23",
      withCash(held, 100_000),
      {},
      {
        cashBufferCents: 200_000,
      },
    );
    expect(kinds(buffered)).not.toContain("new_money_rebalance");
  });
});

describe("the person's own mix", () => {
  it("aims new money at the mix the settings keep (after the glide path), not the plain model", async () => {
    const held = withCash(await boughtOn(4, "2026-09-01"), 100_000);
    const weights = glideWeights(4, "2028-01-01", "2026-10-08").weights;
    const [flag] = one(
      await scanOn(4, "2026-10-08", held, { weights }, { goalDate: "2028-01-01" }),
      "new_money_rebalance",
    );
    // The glided mix holds less in stocks than the High model: new money goes only to kinds
    // the glided mix is short of, and some of it to a kind the plain model wouldn't add to.
    const model = MODEL_PORTFOLIOS[4].weights;
    const classOfTicker = (t: string) =>
      (Object.keys(PRACTICE_ETFS) as PracticeClass[]).find((c) => classTickers(c).includes(t))!;
    const bought = flag.trades.map((t) => classOfTicker(t.ticker));
    expect(bought.some((c) => weights[c] > model[c])).toBe(true);
    expect(bought).not.toContain("us_stocks");
  });
});

describe("cash drag", () => {
  it("fires when cash above the buffer has sat for days, buying the level's own mix", async () => {
    const held = withCash(await boughtOn(3, "2026-09-01"), 50_000);
    const flags = await scanOn(3, "2026-10-08", held);
    const [flag] = one(flags, "cash_drag");
    expect(flag).toBeDefined();
    expect(flag.trades.every((t) => t.side === "buy")).toBe(true);
    const own = new Set(
      (Object.keys(PRACTICE_ETFS) as PracticeClass[]).flatMap((c) => classTickers(c)),
    );
    expect(flag.trades.every((t) => own.has(t.ticker))).toBe(true);
    expect(flag.amountCents).toBeLessThanOrEqual(50_000);
    expect(flag.headline).toMatch(/^Invest \$/);
    expectShortForms(flag);
  });

  it("doesn't count new practice money as idle: the days run from the last deposit", async () => {
    const held = withCash(await boughtOn(3, "2026-09-01"), 50_000);
    expect(
      kinds(await scanOn(3, "2026-10-01", held, { lastDepositOn: "2026-10-01" })),
    ).not.toContain("cash_drag");
    const [later] = one(
      await scanOn(3, "2026-10-08", held, { lastDepositOn: "2026-10-01" }),
      "cash_drag",
    );
    expect(later.reason).toMatch(/waited 7 days/);
  });

  it("doesn't fire just after a buy, under the minimum, or within the buffer", async () => {
    const held = withCash(await boughtOn(3, "2026-10-06"), 50_000);
    expect(kinds(await scanOn(3, "2026-10-08", held))).not.toContain("cash_drag");
    const older = await boughtOn(3, "2026-09-01");
    expect(kinds(await scanOn(3, "2026-10-08", withCash(older, 5_000)))).not.toContain("cash_drag");
    const buffered = await scanOn(
      3,
      "2026-10-08",
      withCash(older, 50_000),
      {},
      {
        cashBufferCents: 40_000,
      },
    );
    expect(kinds(buffered)).not.toContain("cash_drag");
  });
});

describe("a cheaper equivalent fund", () => {
  // International stocks held in IXUS (0.07% a year) after a swap; VXUS costs 0.05%.
  async function inIxus(costShare: number) {
    const held = await boughtOn(3, "2026-08-03");
    const vxus = positionValue(held.state, await pricesOn("2026-08-03"), "VXUS");
    const swapped = await move(held, "2026-08-03", "VXUS", "IXUS", vxus - 100);
    const prices = await pricesOn("2026-10-08");
    const value = positionValue(swapped.state, prices, "IXUS");
    const ixus = { ...swapped.state.positions.IXUS, costBasisCents: Math.round(value * costShare) };
    const state = { ...swapped.state, positions: { ...swapped.state.positions, IXUS: ixus } };
    return { ...swapped, state };
  }

  it("switches to the cheaper twin of the same kind, same amount out and in", async () => {
    const held = await inIxus(1.02);
    const [flag] = one(await scanOn(3, "2026-10-08", held), "cheaper_fund");
    expect(flag).toBeDefined();
    expect(flag.trades).toEqual([
      expect.objectContaining({ ticker: "IXUS", side: "sell" }),
      expect.objectContaining({ ticker: "VXUS", side: "buy" }),
    ]);
    expect(flag.trades[0].amountCents).toBe(flag.trades[1].amountCents);
    expect(flag.figures.find((f) => f.label === "Saved a year")).toBeDefined();
    expectShortForms(flag);
  });

  it("never sells at a gain when taxes matter, unless the person said they don't", async () => {
    const held = await inIxus(0.9);
    expect(kinds(await scanOn(3, "2026-10-08", held))).not.toContain("cheaper_fund");
    const relaxed = await scanOn(3, "2026-10-08", held, {}, { taxSensitive: false });
    expect(kinds(relaxed)).toContain("cheaper_fund");
  });

  it("never makes a wash sale, buys an excluded fund, or swaps twins that cost the same", async () => {
    const held = await inIxus(1.02);
    const soldVxus: PastTrade = {
      placedAt: "2026-10-01T21:00:00.000Z",
      side: "sell",
      ticker: "VXUS",
      quantity: 1,
      amountCents: 6_000,
      gainCents: -300,
      rule: "tax_loss_harvest",
    };
    const blocked = { ...held, trades: [...held.trades, soldVxus] };
    expect(kinds(await scanOn(3, "2026-10-08", blocked))).not.toContain("cheaper_fund");
    const boughtIxus: PastTrade = { ...soldVxus, side: "buy", ticker: "IXUS", gainCents: null };
    const recent = { ...held, trades: [...held.trades, boughtIxus] };
    expect(kinds(await scanOn(3, "2026-10-08", recent))).not.toContain("cheaper_fund");
    const excluded = await scanOn(3, "2026-10-08", held, {}, { excludedTickers: ["VXUS"] });
    expect(kinds(excluded)).not.toContain("cheaper_fund");
    // VTI and ITOT both cost 0.03%: nothing to switch.
    const plain = await boughtOn(3, "2026-08-03");
    expect(kinds(await scanOn(3, "2026-10-08", plain))).not.toContain("cheaper_fund");
  });
});

describe("tax-loss swaps, watched daily", () => {
  it("is keyed by the day, so a loss found later in the month isn't hidden by an earlier one", async () => {
    const held = await boughtOn(3, "2026-09-01");
    const [flag] = one(await scanOn(3, "2026-10-14", held), "tax_loss_harvest");
    expect(flag.key).toBe(`tax_loss_harvest:${flag.ticker}:2026-10-14`);
  });

  it("is off when the person says taxes don't matter here", async () => {
    const held = await boughtOn(3, "2026-09-01");
    const flags = await scanOn(3, "2026-10-14", held, {}, { taxSensitive: false });
    expect(kinds(flags)).not.toContain("tax_loss_harvest");
  });
});

describe("contribution timing after a payday", () => {
  it("suggests moving the monthly practice money to just after payday", async () => {
    const held = await boughtOn(3, "2026-09-01");
    const [flag] = one(await scanOn(3, "2026-10-08", held, { paydayDay: 15 }), "payday_timing");
    expect(flag).toBeDefined();
    expect(flag.headline).toBe("Move practice money to the 16th, after payday");
    expectShortForms(flag);
    expect(flag.trades).toEqual([]);
  });

  it("stays quiet when the days are close, payday is unknown or there's no monthly money", async () => {
    const held = await boughtOn(3, "2026-09-01");
    for (const extra of [
      { paydayDay: 15, addDay: 17 },
      { paydayDay: null },
      { paydayDay: 15, monthlyAddCents: 0 },
    ]) {
      expect(kinds(await scanOn(3, "2026-10-08", held, extra))).not.toContain("payday_timing");
    }
  });

  it("reads the main payday from the pay schedules: set days only, the biggest paycheck", () => {
    const pay = (frequency: string, days: number[], amountCents: number, active = true) =>
      ({ frequency, days, amountCents, active }) as Parameters<typeof mainPaydayDay>[0][number];
    expect(
      mainPaydayDay([pay("SEMI_MONTHLY", [15, 31], 200_000), pay("MONTHLY", [5], 50_000)]),
    ).toBe(15);
    expect(mainPaydayDay([pay("MONTHLY", [5], 300_000, false), pay("MONTHLY", [20], 50_000)])).toBe(
      20,
    );
    expect(mainPaydayDay([pay("BIWEEKLY", [], 300_000)])).toBeNull();
    expect(mainPaydayDay([])).toBeNull();
  });

  it("wraps a payday at the end of the month to the 1st", () => {
    expect(addDayAfter(15)).toBe(16);
    expect(addDayAfter(30)).toBe(1);
    expect(addDayAfter(31)).toBe(1);
  });
});

describe("a drift warning before the band is hit", () => {
  // Stocks pushed `share` of the portfolio over target, on a calm day.
  async function pushed(share: number) {
    const held = await boughtOn(3, "2026-09-01");
    const total = portfolioValue(held.state, await pricesOn("2026-09-01"));
    return move(held, "2026-09-01", "BND", "VTI", Math.round(share * total));
  }

  it("warns at 4.2 points off with a 5-point band, and trades nothing", async () => {
    const held = await pushed(0.042);
    const flags = await scanOn(3, "2026-09-01", held);
    const [flag] = one(flags, "drift_warning");
    expect(flag).toBeDefined();
    expect(flag.trades).toEqual([]);
    expect(flag.headline).toMatch(/points off; band is 5$/);
    expectShortForms(flag);
    expect(kinds(flags)).not.toContain("drift_rebalance");
  });

  it("stays quiet well inside the band, and past it (the rebalance is flagged instead)", async () => {
    expect(kinds(await scanOn(3, "2026-09-01", await pushed(0.02)))).not.toContain("drift_warning");
    const past = await scanOn(3, "2026-09-01", await pushed(0.08));
    expect(kinds(past)).not.toContain("drift_warning");
    expect(kinds(past)).toContain("drift_rebalance");
  });

  it("gives way to new money when cash is waiting", async () => {
    const held = withCash(await pushed(0.042), 50_000);
    const flags = await scanOn(3, "2026-09-01", held);
    expect(kinds(flags)).toContain("new_money_rebalance");
    expect(kinds(flags)).not.toContain("drift_warning");
  });
});

describe("the goal-date glide path", () => {
  // The practice settings apply step 157's glide path to the mix (practice-profile.ts); the
  // scan says so each time it steps down.
  const glided = (level: RiskLevel, goalDate: string | null, today: string) =>
    glideWeights(level, goalDate, today).weights;

  it("tells the person when their mix steps toward bonds as the goal nears", async () => {
    const held = await boughtOn(4, "2026-09-01");
    const weights = glided(4, "2029-10-01", "2026-10-08");
    const [flag] = one(
      await scanOn(4, "2026-10-08", held, { weights }, { goalDate: "2029-10-01" }),
      "glide_path",
    );
    expect(flag).toBeDefined();
    expect(flag.trades).toEqual([]);
    expect(flag.key).toBe(
      `glide_path:2029-10-01:${Math.round((weights.us_stocks + weights.intl_stocks) * 100)}`,
    );
    expect(flag.figures.find((f) => f.label === "Stocks at High")?.value).toBe("75%");
    expectShortForms(flag);
  });

  it("stays quiet with years to go, or no goal date: the mix is the level's own", async () => {
    const held = await boughtOn(5, "2026-09-01");
    for (const goalDate of ["2050-01-01", null]) {
      const weights = glided(5, goalDate, "2026-10-08");
      expect(kinds(await scanOn(5, "2026-10-08", held, { weights }, { goalDate }))).not.toContain(
        "glide_path",
      );
    }
  });
});

describe("more risk than you said", () => {
  it("flags a Very high mix for someone who said 25%, and names the level the settings would pick", async () => {
    const held = await boughtOn(5, "2026-09-01");
    const prices = await pricesOn("2026-10-08");
    // On its model, a level reads exactly its worst replay drop.
    expect(heldDrop(5, held.state, prices)).toBeCloseTo(LEVEL_WORST_DROP_PERCENT[5] / 100, 1);
    const [flag] = one(
      await scanOn(5, "2026-10-08", held, {}, { maxDropShare: 0.25 }),
      "risk_mismatch",
    );
    expect(flag).toBeDefined();
    expect(flag.trades).toEqual([]);
    expect(levelWithin(0.25)).toBe(levelForDrop(5, 25));
    expect(flag.figures.find((f) => f.label === "A level within your limit")?.value).toBe("Medium");
  });

  it("never contradicts the settings: a level they pick for a stated drop is within it", async () => {
    for (const level of [1, 2, 3, 4, 5] as const) {
      const limit = LEVEL_WORST_DROP_PERCENT[level];
      expect(levelForDrop(5, limit)).toBe(level);
      const held = await boughtOn(level, "2026-09-01");
      expect(
        kinds(await scanOn(level, "2026-09-01", held, {}, { maxDropShare: limit / 100 })),
        `level ${level}`,
      ).not.toContain("risk_mismatch");
    }
  });

  it("leaves a drifted mix to the rebalance when the level itself fits", async () => {
    const held = await boughtOn(3, "2026-09-01");
    const total = portfolioValue(held.state, await pricesOn("2026-09-01"));
    const drifted = await move(held, "2026-09-01", "BND", "VTI", Math.round(0.3 * total));
    const limit = LEVEL_WORST_DROP_PERCENT[3] / 100;
    const flags = kinds(await scanOn(3, "2026-09-01", drifted, {}, { maxDropShare: limit }));
    expect(flags).toContain("drift_rebalance");
    expect(flags).not.toContain("risk_mismatch");
  });

  it("stays quiet within the stated drop, or with none stated", async () => {
    const held = await boughtOn(3, "2026-09-01");
    for (const maxDropShare of [0.4, null]) {
      expect(kinds(await scanOn(3, "2026-10-08", held, {}, { maxDropShare }))).not.toContain(
        "risk_mismatch",
      );
    }
  });
});

describe("close to the stated max drop", () => {
  it("suggests one level safer when the 2020 shock takes it most of the way", async () => {
    const held = await boughtOn(4, "2020-02-18");
    const [flag] = one(
      await scanOn(4, "2020-03-23", held, {}, { maxDropShare: 0.25 }),
      "max_drop_near",
    );
    expect(flag).toBeDefined();
    expect(flag.trades).toEqual([]);
    expect(flag.reason).toMatch(/isn't a call on where markets go next/);
    expect(flag.figures.find((f) => f.label === "Next level down")?.value).toBe("Medium");
  });

  it("stays quiet on a calm day, with a wide limit, or at Very low", async () => {
    const calm = await boughtOn(4, "2026-09-01");
    expect(kinds(await scanOn(4, "2026-10-08", calm, {}, { maxDropShare: 0.25 }))).not.toContain(
      "max_drop_near",
    );
    const shock = await boughtOn(4, "2020-02-18");
    expect(kinds(await scanOn(4, "2020-03-23", shock, {}, { maxDropShare: 0.6 }))).not.toContain(
      "max_drop_near",
    );
    const low = await boughtOn(1, "2020-02-18");
    expect(kinds(await scanOn(1, "2020-03-23", low, {}, { maxDropShare: 0.05 }))).not.toContain(
      "max_drop_near",
    );
  });
});

describe("preferences on the step 292 kinds", () => {
  it("no appetite: no dips or news; low: no news; an excluded company is never bought", async () => {
    const held = withCash(await boughtOn(4, "2026-09-01"), 50_000);
    const all = [
      ...(await scanOn(4, "2026-10-09", held)),
      ...(await scanOn(4, "2026-10-14", held)),
    ];
    expect(kinds(all)).toContain("news_idea");
    expect(kinds(all)).toContain("dip_buy");
    const none = [
      ...(await scanOn(4, "2026-10-09", held, {}, { appetite: "none" })),
      ...(await scanOn(4, "2026-10-14", held, {}, { appetite: "none" })),
    ];
    expect(kinds(none)).not.toContain("news_idea");
    expect(kinds(none)).not.toContain("dip_buy");
    const low = await scanOn(4, "2026-10-09", held, {}, { appetite: "low" });
    expect(kinds(low)).not.toContain("news_idea");
    const excluded = await scanOn(4, "2026-10-09", held, {}, { excludedTickers: ["nvda"] });
    expect(excluded.flatMap((f) => f.trades.map((t) => t.ticker))).not.toContain("NVDA");
  });

  it("shows the news summary on a news idea when there is one", async () => {
    const held = withCash(await boughtOn(4, "2026-09-01"), 50_000);
    const headlines = (await market.news(PRACTICE_STOCKS, "2026-10-07", "2026-10-09")).map((h) => ({
      ...h,
      summary: `${h.ticker}: ${h.title}.`,
      summaryBy: "rules" as const,
    }));
    const [idea] = one(await scanOn(4, "2026-10-09", held, { headlines }), "news_idea");
    expect(idea.figures.find((f) => f.label === "Summary (rules)")?.value).toMatch(/^NVDA: /);
  });
});

describe("caps and the card's needs", () => {
  async function everything() {
    const shock = withCash(await boughtOn(4, "2020-02-18"), 100_000);
    const calm = withCash(await boughtOn(4, "2026-09-01"), 50_000);
    const prefs = { maxDropShare: 0.2, goalDate: "2031-01-01" };
    return [
      ...(await scanOn(4, "2020-03-23", shock, { paydayDay: 15 }, prefs)),
      ...(await scanOn(4, "2026-10-08", calm, { paydayDay: 15 }, prefs)),
    ];
  }

  it("holds the monthly count cap and never flags the same key twice", async () => {
    const held = withCash(await boughtOn(4, "2020-02-18"), 100_000);
    const prefs = { maxDropShare: 0.2, goalDate: "2031-01-01" };
    const first = await scanOn(4, "2020-03-23", held, { paydayDay: 15 }, prefs);
    const newKinds = first.filter((f) => (OPPORTUNITY_KINDS as readonly string[]).includes(f.kind));
    expect(newKinds.length).toBeGreaterThan(2);
    const full = Object.fromEntries(OPPORTUNITY_KINDS.map((k) => [k, SCAN_CAPS[k].perMonth]));
    const capped = await scanOn(
      4,
      "2020-03-23",
      held,
      { paydayDay: 15, usedThisMonth: full },
      prefs,
    );
    expect(capped.filter((f) => (OPPORTUNITY_KINDS as readonly string[]).includes(f.kind))).toEqual(
      [],
    );
    // The next run that day, as the runner makes it: the keys seen and this month's count.
    const seen = new Set(first.map((f) => f.key));
    const used: Partial<Record<ScanKind, number>> = {};
    for (const f of first) used[f.kind] = (used[f.kind] ?? 0) + 1;
    const again = await scanOn(
      4,
      "2020-03-23",
      held,
      { paydayDay: 15, seen, usedThisMonth: used },
      prefs,
    );
    expect(again.filter((f) => seen.has(f.key))).toEqual([]);
    for (const k of OPPORTUNITY_KINDS) {
      expect((used[k] ?? 0) + one(again, k).length).toBeLessThanOrEqual(SCAN_CAPS[k].perMonth);
    }
  });

  it("gives every flag numbers, caps and a confidence with its reason; safety kinds never trade", async () => {
    const flags = await everything();
    expect(new Set(kinds(flags)).size).toBeGreaterThanOrEqual(8);
    for (const f of flags) {
      expect(f.headline.length).toBeLessThanOrEqual(60);
      expect(f.reason.length).toBeGreaterThan(30);
      expect(f.figures.length).toBeGreaterThan(0);
      expect(f.caps.length).toBeGreaterThan(0);
      expect(f.confidence.percent).toBeGreaterThan(0);
      expect(f.confidence.percent).toBeLessThan(100);
      expect(f.confidence.reason.length).toBeGreaterThan(20);
      expect(f.trades.every((t) => t.rule === f.kind && t.reason === f.reason)).toBe(true);
      if ((SAFETY_KINDS as readonly string[]).includes(f.kind)) expect(f.trades).toEqual([]);
      expectShortForms(f);
    }
  });

  it("never spends more cash than is waiting above the buffer", async () => {
    for (const day of ["2020-03-23", "2026-10-08", "2026-10-14"]) {
      const held = withCash(await boughtOn(4, day < "2021" ? "2020-02-18" : "2026-09-01"), 60_000);
      const prices = await pricesOn(day);
      let state = held.state;
      for (const f of await scanOn(4, day, held, {}, { cashBufferCents: 10_000 })) {
        for (const t of f.trades) {
          state = apply(state, { ...t, priceCents: prices[t.ticker] }, PRACTICE_UNIVERSE).state;
        }
      }
      expect(state.cashCents).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("step 292 kinds, after the QA pass", () => {
  it("says nothing about a rebalance smaller than a trade", async () => {
    const held = await boughtOn(3, "2026-09-01", 10_000);
    const prices = await pricesOn("2026-09-01");
    const total = portfolioValue(held.state, prices);
    const drifted = await move(held, "2026-09-01", "BND", "VTI", Math.round(0.06 * total));
    expect(drift(3, drifted.state, prices).past).toBe(true);
    const flags = scanPortfolio({
      level: 3,
      state: drifted.state,
      prices,
      history: await historyTo("2026-09-01"),
      trades: drifted.trades,
      headlines: [],
      today: "2026-09-01",
      opportunitiesPaused: false,
      usedThisMonth: {},
      seen: new Set(),
    });
    expect(kinds(flags)).not.toContain("drift_rebalance");
  });

  it("names the fund a dip buy really buys when it isn't the one that dipped", async () => {
    // International stocks held in IXUS, at a loss in this autumn's dip: the dip buy goes into
    // VXUS (buying IXUS would turn the loss still to harvest into a wash sale).
    const held = await boughtOn(3, "2026-08-03");
    const vxus = positionValue(held.state, await pricesOn("2026-08-03"), "VXUS");
    const swapped = withCash(await move(held, "2026-08-03", "VXUS", "IXUS", vxus - 100), 50_000);
    const flags = one(await scanOn(3, "2026-10-15", swapped), "dip_buy");
    for (const f of flags) {
      const bought = f.trades[0].ticker;
      expect(f.ask.headline).toContain(bought);
      expect(f.headline).toContain(bought);
    }
  });
});
