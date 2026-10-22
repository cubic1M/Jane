import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import type { RiskLevel } from "@/config/investing";
import { PEOPLE, type PersonId } from "@/config/people";
import {
  AUTOPILOT_LIMITS,
  OPPORTUNITY_LEVELS,
  PRACTICE_MONTHLY_ADD_CENTS,
  PRACTICE_START_CENTS,
  PRACTICE_STOCKS,
  PRACTICE_UNIVERSE,
} from "@/config/portfolios";
import { PRACTICE_DETECTORS } from "@/detectors/practice";
import type { Bar } from "@/lib/market";
import { SampleMarketData } from "@/lib/market/sample";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { opportunityCard } from "./practice-cards";
import { planTrades, portfolioValue, violates } from "./practice-autopilot";
import { apply, balances, type Entry, type LedgerState } from "./practice-ledger";
import { practiceLevel, type PracticeAnswers } from "./practice-level";
import { scanPortfolio, washBlocked, type PastTrade, type ScanFlag } from "./practice-scan";

// Spec step 297: Stage A walked through the eight sample people. Each answers the step 288
// questions, starts a practice portfolio on 2026-09-01 and lets Jane run it day by day through
// this autumn's dip on the sample market: the monthly practice money, the daily scan, then the
// autopilot. Practice money and the paper ledger only: no real account, no real order.

type Answers = PracticeAnswers & { expect: RiskLevel };
const ask = (
  horizon: string,
  dropReaction: string,
  stability: "steady" | "variable",
  goal: string,
  expect: RiskLevel,
): Answers => ({ horizon, dropReaction, stability, goals: [goal], expect });

// Each person's answers to the four questions, and the level they should give.
const ANSWERS: Record<PersonId, Answers> = {
  renter: ask("over_20", "fine", "steady", "retirement", 4),
  family: ask("10_to_20", "worry", "steady", "education", 3),
  freelancer: ask("over_20", "buy", "variable", "retirement", 4),
  equity: ask("over_20", "buy", "steady", "retirement", 5),
  preretire: ask("3_to_10", "worry", "steady", "retirement", 3),
  retiree: ask("under_3", "sell", "steady", "retirement", 1),
  debt: ask("3_to_10", "sell", "steady", "home", 1),
  owner: ask("10_to_20", "fine", "variable", "retirement", 3),
};

const market = new SampleMarketData();
const STOCKS = PRACTICE_STOCKS as readonly string[];
const FROM = "2026-09-01";
const TO = "2026-10-22";
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

type Walk = {
  level: RiskLevel;
  state: LedgerState;
  entries: Entry[];
  trades: PastTrade[];
  flags: ScanFlag[];
  lowestCash: number;
};

// One person's seven weeks, as the daily run does it (src/lib/practice/scan.ts), in memory.
async function walk(level: RiskLevel): Promise<Walk> {
  let state: LedgerState = { cashCents: PRACTICE_START_CENTS, positions: {} };
  const entries: Entry[] = [];
  const trades: PastTrade[] = [];
  const flags: ScanFlag[] = [];
  const seen = new Set<string>();
  const used: Partial<Record<ScanFlag["kind"], number>> = {};
  let lowestCash = state.cashCents;
  let month = "";
  const place = (
    t: { ticker: string; side: "buy" | "sell"; amountCents: number; rule: string },
    day: string,
    prices: Record<string, number>,
  ) => {
    const entry: Entry = { ...t, priceCents: prices[t.ticker] };
    const done = apply(state, entry, PRACTICE_UNIVERSE);
    state = done.state;
    entries.push(entry);
    lowestCash = Math.min(lowestCash, state.cashCents);
    trades.push({
      placedAt: `${day}T21:00:00.000Z`,
      side: t.side,
      ticker: t.ticker,
      quantity: done.quantity,
      amountCents: t.amountCents,
      gainCents: done.gainCents,
      rule: t.rule,
    });
  };
  for (const { date: day } of await market.prices("VTI", FROM, TO)) {
    const prices = await pricesOn(day);
    if (day.slice(0, 7) !== month) {
      month = day.slice(0, 7);
      for (const k of Object.keys(used)) delete used[k as ScanFlag["kind"]];
      if (day !== FROM) {
        state = { ...state, cashCents: state.cashCents + PRACTICE_MONTHLY_ADD_CENTS };
        entries.push({ side: "deposit", amountCents: PRACTICE_MONTHLY_ADD_CENTS });
      }
    }
    let today = trades.filter((t) => t.placedAt.startsWith(day)).length;
    if (day !== FROM) {
      const history: Record<string, Bar[]> = {};
      for (const t of PRACTICE_UNIVERSE) {
        history[t] = await market.prices(t, daysBefore(day, 50), day);
      }
      const found = scanPortfolio({
        level,
        state,
        prices,
        history,
        trades,
        headlines: await market.news(PRACTICE_STOCKS, daysBefore(day, 2), day),
        today: day,
        opportunitiesPaused: false,
        usedThisMonth: used,
        seen,
      });
      for (const f of found) {
        // The runner's hard-limit check, trade by trade, before anything is placed.
        let s = state;
        let n = today;
        const held = f.trades.some((t) => {
          const why = violates(t, s, prices, n);
          if (!why) s = apply(s, { ...t, priceCents: prices[t.ticker] }, PRACTICE_UNIVERSE).state;
          n += 1;
          return why !== null;
        });
        if (held) continue;
        seen.add(f.key);
        used[f.kind] = (used[f.kind] ?? 0) + 1;
        flags.push(f);
        for (const t of f.trades) place(t, day, prices);
        today += f.trades.length;
      }
    }
    const plan = planTrades({
      level,
      state,
      prices,
      paused: false,
      tradesToday: today,
      blocked: washBlocked(trades, day),
    });
    // Sales first, so their cash pays for the buys.
    const sales = plan.filter((t) => t.side === "sell");
    for (const t of [...sales, ...plan.filter((t) => t.side === "buy")]) place(t, day, prices);
  }
  return { level, state, entries, trades, flags, lowestCash };
}

describe("Stage A, walked through the eight sample people", () => {
  for (const person of PEOPLE) {
    it(`${person.name}: a level, practice money, the dip, and nothing real`, async () => {
      const answers = ANSWERS[person.id];
      const level = practiceLevel(answers);
      expect(level.complete).toBe(true);
      if (!level.complete) return;
      expect(level.level).toBe(answers.expect);
      expect(level.reason.length).toBeGreaterThan(20);

      const w = await walk(level.level);
      // The ledger balances to the cent, never borrows, and holds only the practice universe.
      expect(balances(PRACTICE_START_CENTS, w.entries, w.state)).toBe(true);
      expect(w.lowestCash).toBeGreaterThanOrEqual(0);
      expect(Object.keys(w.state.positions).every((t) => PRACTICE_UNIVERSE.has(t))).toBe(true);
      expect(w.trades.every((t) => t.rule.length > 0)).toBe(true);
      // Opportunities only at High and Very high, each company within its cap.
      const ideas = w.flags.filter((f) => f.kind === "news_idea");
      const stocks = w.trades.filter((t) => STOCKS.includes(t.ticker ?? ""));
      if (!OPPORTUNITY_LEVELS.includes(level.level)) {
        expect(ideas).toEqual([]);
        expect(stocks).toEqual([]);
      }
      const prices = await pricesOn(TO);
      const total = portfolioValue(w.state, prices);
      expect(total).toBeGreaterThan(0);
      for (const t of PRACTICE_STOCKS) {
        const p = w.state.positions[t];
        // At most the cap when bought; prices move after.
        const share = p ? (p.quantity * prices[t]) / total : 0;
        expect(share).toBeLessThan(AUTOPILOT_LIMITS.perStockShare * 1.5);
      }
      // Every flag is a card with a percentage, a reason and only the pause switch behind it.
      for (const [i, f] of w.flags.entries()) {
        const card = opportunityCard({
          id: `${person.id}-${i}`,
          kind: f.kind,
          headline: f.headline,
          reason: f.reason,
          confidence: f.confidence.percent,
          status: "acted",
          details: { figures: f.figures, caps: f.caps, confidence: f.confidence, heldBy: null },
        });
        expect(card.details.confidence?.percent).toBeGreaterThan(0);
        expect(card.yesLabel).toBe("Pause switch");
      }
    });
  }

  it("brings this autumn's dip to someone, and the practice suggestion to the right people", async () => {
    const kinds = new Set<string>();
    for (const person of PEOPLE) {
      const level = practiceLevel(ANSWERS[person.id]);
      if (level.complete) {
        for (const f of (await walk(level.level)).flags) kinds.add(f.kind);
      }
      const data = inputFor(person.id);
      const suggestion = PRACTICE_DETECTORS[0].detect({ profile: buildProfile(data), data });
      const suggested = suggestion !== null;
      expect(suggested, person.id).toBe(person.should.includes("practice_portfolio"));
    }
    expect(kinds.has("tax_loss_harvest")).toBe(true);
    expect(kinds.has("news_idea")).toBe(true);
  });
});
