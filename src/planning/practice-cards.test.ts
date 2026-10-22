import { describe, expect, it } from "vitest";
import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { PRACTICE_STOCKS, PRACTICE_UNIVERSE } from "@/config/portfolios";
import { HEADLINE_MAX_WORDS, cardHeadline } from "@/detectors/contract";
import type { FloatingCardData } from "@/lib/floating-cards";
import type { Bar } from "@/lib/market";
import { SampleMarketData } from "@/lib/market/sample";
import { opportunityCard, tradeDays, tradesCard, WHAT_YES_DOES } from "./practice-cards";
import { planTrades } from "./practice-autopilot";
import { apply, type LedgerState } from "./practice-ledger";
import { scanPortfolio, type PastTrade, type ScanFlag } from "./practice-scan";

// Spec step 296: the cards follow the chat lane's card shape, every card has a percentage and a
// reason, and no card offers a real trade.

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

// The scan's real flags on the sample market, for a High portfolio bought on 2026-09-01.
async function flags(): Promise<ScanFlag[]> {
  const bought = await pricesOn("2026-09-01");
  let state: LedgerState = { cashCents: 1_000_000, positions: {} };
  const trades: PastTrade[] = [];
  for (const t of planTrades({ level: 4, state, prices: bought, paused: false, tradesToday: 0 })) {
    const done = apply(state, { ...t, priceCents: bought[t.ticker] }, PRACTICE_UNIVERSE);
    state = done.state;
    const placedAt = "2026-09-01T21:00:00.000Z";
    trades.push({ ...t, placedAt, quantity: done.quantity, gainCents: done.gainCents });
  }
  state = { ...state, cashCents: state.cashCents + 50_000 };
  const out: ScanFlag[] = [];
  for (const day of ["2026-10-09", "2026-10-14"]) {
    const history: Record<string, Bar[]> = {};
    for (const t of PRACTICE_UNIVERSE) {
      history[t] = await market.prices(t, daysBefore(day, 50), day);
    }
    const found = scanPortfolio({
      level: 4,
      state,
      prices: await pricesOn(day),
      history,
      trades,
      headlines: await market.news(PRACTICE_STOCKS, daysBefore(day, 2), day),
      today: day,
      opportunitiesPaused: false,
      usedThisMonth: {},
      seen: new Set(),
    });
    out.push(...found);
  }
  return out;
}

// A flag as the scan stores it (src/lib/practice/scan.ts).
const row = (f: ScanFlag, i: number, status = "acted") => ({
  id: `o${i}`,
  kind: f.kind,
  headline: f.headline,
  reason: f.reason,
  confidence: f.confidence.percent,
  status,
  details: { figures: f.figures, caps: f.caps, confidence: f.confidence, heldBy: null },
});

function expectShape(card: FloatingCardData) {
  const headline = cardHeadline(card.headline);
  const words = headline.trim().split(/\s+/).length;
  expect(words, card.headline).toBeLessThanOrEqual(HEADLINE_MAX_WORDS);
  expect((card.headline.match(/\$[\d,.]+/g) ?? []).length).toBeLessThanOrEqual(1);
  expect(card.details.confidence!.percent).toBeGreaterThan(0);
  expect(card.details.confidence!.percent).toBeLessThan(100);
  expect(card.details.confidence!.reason.length).toBeGreaterThan(20);
  expect(card.details.why!.length).toBeGreaterThan(20);
  expect(card.details.figures!.length).toBeGreaterThan(1);
  expect(card.details.notes).toContain(DEMO_ADVICE_LABEL);
  expect(card.details.notes!.some((n) => n.startsWith("Cap: "))).toBe(true);
  // The button only opens the pause switch.
  expect(card.yesLabel).toBe("Pause switch");
  expect(card.details.whatYesDoes).toBe(WHAT_YES_DOES);
  expect(`${card.yesLabel} ${card.notNowLabel}`).not.toMatch(/\b(?:buy|sell|trade|order)\b/i);
}

describe("the practice portfolio's cards", () => {
  it("shows every kind of flag the scan finds as a short card with its reasoning behind it", async () => {
    const found = await flags();
    expect(new Set(found.map((f) => f.kind)).size).toBeGreaterThanOrEqual(3);
    for (const [i, f] of found.entries()) {
      const card = opportunityCard(row(f, i));
      expectShape(card);
      expect(card.id).toBe(`opportunity:o${i}`);
      expect(card.details.figures![0]).toMatchObject({ label: "Rule" });
      expect(card.details.confidence).toEqual(f.confidence);
    }
  });

  it("says so when a cap held a flag back", async () => {
    const [f] = await flags();
    const card = opportunityCard({
      ...row(f, 0, "held"),
      details: { ...row(f, 0).details, heldBy: "more than the per-position cap" },
    });
    expectShape(card);
    expect(card.headline).toMatch(/^Held back: /);
    expect(card.details.figures).toContainEqual({
      label: "Status",
      value: "Not done: more than the per-position cap",
    });
  });

  it("shows the autopilot's trades as one card a day", () => {
    const at = (day: string) => new Date(`${day}T21:00:00Z`);
    const trades = [
      { id: "t1", placedAt: at("2026-09-01"), side: "buy", ticker: "VTI", amountCents: 500_000 },
      { id: "t2", placedAt: at("2026-09-01"), side: "buy", ticker: "BND", amountCents: 200_000 },
      { id: "t3", placedAt: at("2026-10-14"), side: "sell", ticker: "VTI", amountCents: 80_000 },
    ].map((t, i) => ({ ...t, reason: "A reason.", rule: i < 2 ? "model_buy" : "rebalance" }));
    const days = tradeDays(trades);
    expect(days.map((d) => d.day)).toEqual(["2026-10-14", "2026-09-01"]);
    const first = tradesCard(days[1].day, 4, days[1].trades);
    expectShape(first);
    expect(first.headline).toBe("Bought the High model for $7,000");
    const later = tradesCard(days[0].day, 4, days[0].trades);
    expectShape(later);
    expect(later.headline).toBe("Rebalanced $800 back to your mix");
    expect(later.id).toBe("trades:2026-10-14");
  });
});
