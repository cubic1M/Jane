import { describe, expect, it } from "vitest";
import {
  classTickers,
  PRACTICE_ETFS,
  PRACTICE_STOCKS,
  PRACTICE_UNIVERSE,
  type PracticeClass,
} from "@/config/portfolios";
import { SCAN_KINDS } from "@/config/practice-scan";
import type { Bar } from "@/lib/market";
import { SampleMarketData } from "@/lib/market/sample";
import { planTrades } from "./practice-autopilot";
import { apply, type LedgerState } from "./practice-ledger";
import { DEFAULT_SCAN_PREFERENCES, scanOpportunities } from "./practice-opportunities";
import type { PastTrade } from "./practice-scan";

// A news idea's summary that Claude wrote says AI wrote it (AI_WRITTEN_LABEL, src/config
// /advice.ts): Anthropic's Usage Policy from Nov 12, 2026 asks that a person know AI was involved in
// anything about their investments. The rules' own summary keeps its label.

const market = new SampleMarketData();
const DAY = "2026-10-09";
const before = (days: number) =>
  new Date(Date.parse(`${DAY}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

async function prices() {
  const out: Record<string, number> = {};
  for (const t of PRACTICE_UNIVERSE) {
    const bar = await market.latest(t, DAY);
    if (bar) out[t] = bar.closeCents;
  }
  return out;
}

async function newsIdea(summaryBy: "claude" | "rules") {
  const now = await prices();
  let state: LedgerState = { cashCents: 1_000_000, positions: {} };
  const trades: PastTrade[] = [];
  for (const t of planTrades({ level: 4, state, prices: now, paused: false, tradesToday: 0 })) {
    const done = apply(state, { ...t, priceCents: now[t.ticker] }, PRACTICE_UNIVERSE);
    state = done.state;
    trades.push({
      placedAt: "2026-09-01T21:00:00.000Z",
      side: t.side,
      ticker: t.ticker,
      quantity: done.quantity,
      amountCents: t.amountCents,
      gainCents: done.gainCents,
      rule: t.rule,
    });
  }
  const history: Record<string, Bar[]> = {};
  for (const c of Object.keys(PRACTICE_ETFS) as PracticeClass[]) {
    for (const t of classTickers(c)) history[t] = await market.prices(t, before(90), DAY);
  }
  const headlines = (await market.news(PRACTICE_STOCKS, before(2), DAY)).map((h) => ({
    ...h,
    summary: `${h.ticker}: ${h.title}.`,
    summaryBy,
  }));
  const flags = scanOpportunities({
    level: 4,
    state: { ...state, cashCents: state.cashCents + 50_000 },
    prices: now,
    history,
    trades,
    headlines,
    today: DAY,
    opportunitiesPaused: false,
    usedThisMonth: {},
    seen: new Set(),
    monthlyAddCents: 50_000,
    addDay: 1,
    paydayDay: null,
    rules: new Set(SCAN_KINDS),
    prefs: DEFAULT_SCAN_PREFERENCES,
  });
  const idea = flags.find((f) => f.kind === "news_idea");
  expect(idea).toBeDefined();
  return idea!.figures.map((f) => f.label);
}

describe("a news idea's summary", () => {
  it("says AI wrote it when Claude did", async () => {
    const labels = await newsIdea("claude");
    expect(labels).toContain("Summary (written by AI)");
    expect(labels).not.toContain("Summary");
  });

  it("keeps the rules' label when the rules wrote it", async () => {
    expect(await newsIdea("rules")).toContain("Summary (rules)");
  });
});
