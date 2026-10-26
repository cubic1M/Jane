import { INTRADAY_AGENT_EVIDENCE } from "@/config/intraday-agent-evidence";
import {
  AGENT_INTERVALS,
  AGENT_LOOKBACK_BARS,
  AGENT_MARKETS,
  AGENT_MAX_CATCHUP_BARS,
  AGENT_WARMUP_HOURS,
  CASH_TICKER,
  type AgentInterval,
  type AgentMarketId,
} from "@/config/trading-agent";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { runAgent, startState } from "@/planning/trading-agent/engine";
import { marketOfPolicy, policyByKey } from "@/planning/trading-agent/policies";
import type { EvidenceRow } from "@/planning/trading-agent/report";
import type { AgentBar, AgentSignal, AgentState, AgentTrade } from "@/planning/trading-agent/types";
import { agentFeed, type AgentFeed } from "./bar-store";

// The 24-hour agent on the paper account (founder, 2026-10-26): the strategy the person picked runs
// at its interval around the clock, on simulated money. Vercel Hobby's cron fires once a day, so
// the agent catches up instead of staying on: each tick (the daily cron, or opening the
// investments page when a bar has closed since) replays every closed bar since the last one, in
// order, through the same loop as the replay (src/planning/trading-agent/engine.ts), so the trades
// are exactly those an always-on agent would have made. Every trade has its time, price, reason,
// fee and spread. The events layer adds signals through registerAgentSignals. Prices only: no
// order is ever sent, and no broker is called. Demo advice only (adviceMode); real accounts are
// unchanged.

type Options = { client?: PrismaClient; now?: Date; feed?: AgentFeed; signals?: AgentSignal[] };

export class AgentError extends Error {}

// Signals from outside the strategy (the events layer), for an account over a range of bar times.
export type AgentSignalSource = (
  userId: string,
  ctx: { client: PrismaClient; from: string; to: string; market: AgentMarketId },
) => Promise<AgentSignal[]>;
const SIGNAL_SOURCES: AgentSignalSource[] = [];
export function registerAgentSignals(source: AgentSignalSource): void {
  if (!SIGNAL_SOURCES.includes(source)) SIGNAL_SOURCES.push(source);
}

// What the account keeps between ticks: the engine's state, and just holding's units.
type Stored = { state: AgentState; hold: { ticker: string; units: number } | null };

const BAR_MS = (interval: AgentInterval) => AGENT_INTERVALS[interval].minutes * 60_000;

// The replay's row for a strategy at a market and interval, if it was run.
export function evidenceFor(
  market: AgentMarketId,
  interval: AgentInterval,
  key: string,
): EvidenceRow | null {
  return (
    INTRADAY_AGENT_EVIDENCE.find((g) => g.market === market && g.interval === interval)?.rows.find(
      (r) => r.key === key,
    ) ?? null
  );
}

// The strategies offered for a market and interval: the replay's order (best Sharpe first), with
// their honest results.
export function agentChoices(market: AgentMarketId, interval: AgentInterval): EvidenceRow[] {
  return (
    INTRADAY_AGENT_EVIDENCE.find((g) => g.market === market && g.interval === interval)?.rows ?? []
  ).filter((r) => policyByKey(r.key) !== null);
}

// How far back to read for the look-back: AGENT_LOOKBACK_BARS bars, in calendar time (market hours
// have 6.5 hours a weekday, so more days).
function lookbackMs(market: AgentMarketId, interval: AgentInterval) {
  const bars = AGENT_LOOKBACK_BARS * BAR_MS(interval);
  if (AGENT_MARKETS[market].session === "24h") return bars;
  const sessions = Math.ceil(
    AGENT_LOOKBACK_BARS / Math.ceil(390 / AGENT_INTERVALS[interval].minutes),
  );
  return Math.ceil(sessions * 1.5 + 6) * 86_400_000;
}

export async function startTradingAgent(
  userId: string,
  choice: { policy: string; interval: AgentInterval },
  { client = defaultClient, now = new Date(), feed, signals }: Options = {},
): Promise<void> {
  if (!(await adviceMode(userId, { client })))
    throw new AgentError("The 24-hour agent runs on the demo bank only for now.");
  const policy = policyByKey(choice.policy);
  const market = marketOfPolicy(choice.policy);
  if (!policy || !market || !(choice.interval in AGENT_INTERVALS))
    throw new AgentError("Pick a strategy and how often it runs.");
  const db = scopedFor(userId, client);
  const account = await db.paperAccounts.findFirst({ include: { positions: true } });
  if (!account) throw new AgentError("Start a paper account first.");
  const prices = account.prices as Record<string, number>;
  // What the account holds goes to cash at its last prices, so the agent starts from cash.
  const sells = account.positions.filter((p) => p.quantity > 1e-9 && (prices[p.ticker] ?? 0) > 0);
  let cash = account.cashCents;
  const trades = sells.map((p) => {
    const amount = Math.floor(p.quantity * prices[p.ticker]);
    cash += amount;
    return {
      accountId: account.id,
      userId,
      placedAt: now,
      ticker: p.ticker,
      side: "sell",
      quantity: p.quantity,
      priceCents: prices[p.ticker],
      amountCents: amount,
      reason: "Sold to cash at its last price so the 24-hour agent runs the whole account.",
      source: "agent_start",
    };
  });
  const param = evidenceFor(market, choice.interval, policy.key)?.param ?? policy.grid[0];
  // It starts a day back, so the first catch-up shows how it trades.
  const state: AgentState = {
    ...startState(cash),
    lastBarAt: new Date(now.getTime() - AGENT_WARMUP_HOURS * 3_600_000).toISOString(),
    lastBarN: 0,
  };
  const stored: Stored = { state, hold: null };
  await client.$transaction(async (tx) => {
    await tx.paperPosition.deleteMany({ where: { accountId: account.id, userId } });
    if (trades.length > 0) await tx.paperTrade.createMany({ data: trades });
    await tx.paperSignal.updateMany({
      where: { accountId: account.id, userId, status: "open" },
      data: { status: "expired", decidedAt: now },
    });
    await tx.paperAccount.update({
      where: { id: account.id, userId },
      data: {
        cashCents: cash,
        agentPolicy: policy.key,
        agentParam: param,
        agentInterval: choice.interval,
        agentMarket: market,
        agentState: stored as never,
        agentStartedAt: now,
        agentLastBarAt: null,
      },
    });
  });
  await logAudit(
    { type: "user", id: userId },
    "paper_agent_started",
    { type: "paper_account", id: account.id },
    { policy: policy.key, interval: choice.interval, market, simulated: "true" },
  );
  await track(userId, "paper_agent_started", { market, interval: choice.interval });
  await tickTradingAgent(userId, { client, now, feed, signals });
}

export async function stopTradingAgent(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const account = await db.paperAccounts.findFirst({ select: { id: true, agentPolicy: true } });
  if (!account?.agentPolicy) return;
  // Its holdings stay; the daily strategy picks the account up again at its next run.
  await db.paperAccounts.update({
    where: { id: account.id },
    data: { agentPolicy: null, agentParam: null, agentInterval: null, agentMarket: null },
  });
  await logAudit(
    { type: "user", id: userId },
    "paper_agent_stopped",
    { type: "paper_account", id: account.id },
    { simulated: "true" },
  );
}

export type TickReport = { ran: boolean; bars: number; trades: number };

// Positions after the trades: units from the state, cost basis carried by each ticker's average.
function positionsAfter(
  before: Readonly<Record<string, { quantity: number; costBasisCents: number }>>,
  trades: readonly AgentTrade[],
  units: Readonly<Record<string, number>>,
) {
  const basis: Record<string, { q: number; cost: number }> = {};
  for (const [t, p] of Object.entries(before)) basis[t] = { q: p.quantity, cost: p.costBasisCents };
  for (const tr of trades) {
    const b = (basis[tr.ticker] ??= { q: 0, cost: 0 });
    if (tr.side === "buy") {
      b.q += tr.quantity;
      b.cost += tr.amountCents + tr.feeCents;
    } else if (b.q > 0) {
      const share = Math.min(1, tr.quantity / b.q);
      b.cost -= b.cost * share;
      b.q -= Math.min(b.q, tr.quantity);
    }
  }
  return Object.entries(units)
    .filter(([t, q]) => q > 1e-12 && t !== CASH_TICKER)
    .map(([ticker, quantity]) => ({
      ticker,
      quantity,
      costBasisCents: Math.round(basis[ticker]?.cost ?? 0),
    }));
}

// One tick: every closed bar since the last, in order. Safe to run twice at once: the second sees
// the first's last bar and stops.
export async function tickTradingAgent(
  userId: string,
  { client = defaultClient, now = new Date(), feed, signals = [] }: Options = {},
): Promise<TickReport> {
  const none = { ran: false, bars: 0, trades: 0 };
  const db = scopedFor(userId, client);
  const account = await db.paperAccounts.findFirst({ include: { positions: true } });
  if (!account?.agentPolicy || !account.agentInterval || !account.agentMarket) return none;
  if (!(await adviceMode(userId, { client }))) return none;
  const policy = policyByKey(account.agentPolicy);
  if (!policy) return none;
  const interval = account.agentInterval as AgentInterval;
  const marketId = account.agentMarket as AgentMarketId;
  const market = AGENT_MARKETS[marketId];
  const source = feed ?? agentFeed(process.env, client);
  const stored = account.agentState as unknown as Stored;
  let state = stored.state;
  const step = BAR_MS(interval);
  // Closed bars only: a bar counts once its whole length has passed (funds: and Alpaca's delay).
  const delay = market.session === "nyse" ? 16 * 60_000 : 60_000;
  const to = new Date(now.getTime() - step - delay).toISOString();
  // A long gap replays at most AGENT_MAX_CATCHUP_BARS bars; the older ones are skipped.
  const oldest = new Date(now.getTime() - AGENT_MAX_CATCHUP_BARS * step).toISOString();
  const after = state.lastBarAt && state.lastBarAt > oldest ? state.lastBarAt : oldest;
  if (to <= after) return none;
  const from = new Date(Date.parse(after) - lookbackMs(marketId, interval)).toISOString();
  const master = marketId === "crypto" ? market.hold : "SPY";
  // The events layer's signals for the range, and their tickers' bars with the strategy's.
  const all: AgentSignal[] = [...signals];
  for (const source of SIGNAL_SOURCES)
    all.push(...(await source(userId, { client, from: after, to, market: marketId })));
  const tickers = [
    ...new Set([
      ...policy.tickers,
      master,
      market.hold,
      ...Object.keys(state.units),
      ...all.map((g) => g.ticker),
    ]),
  ].filter((t) => t !== CASH_TICKER);
  const bars: Record<string, AgentBar[]> = {};
  for (const t of tickers) bars[t] = await source.bars(t, from, to, interval);
  if (after !== state.lastBarAt) {
    // Bars skipped over a long gap still count on the agent's axis; a decision that waited is
    // dropped (its bar is long gone).
    const skipped = (bars[master] ?? []).filter(
      (b) => (!state.lastBarAt || b.t > state.lastBarAt) && b.t <= after,
    ).length;
    state = { ...state, lastBarAt: after, lastBarN: state.lastBarN + skipped, pending: null };
  }
  const run = runAgent(state, bars, all, {
    policy,
    param: account.agentParam ?? policy.grid[0],
    costs: market,
    cash: market.cash,
    master,
    session: market.session,
    minutes: AGENT_INTERVALS[interval].minutes,
  });
  if (run.values.length === 0) return none;
  // Just holding, from the first bar the agent ran: the market's own asset with the same money.
  let hold = stored.hold;
  if (!hold) {
    const first = bars[market.hold]?.find((b) => b.t > (stored.state.lastBarAt ?? ""));
    const edge = (market.halfSpreadBps + market.slippageBps) / 10_000;
    hold = first
      ? {
          ticker: market.hold,
          units: stored.state.startValue / (1 + market.feeBps / 10_000) / (first.o * (1 + edge)),
        }
      : null;
  }
  const closeAt = new Map<string, Record<string, number>>();
  for (const [t, list] of Object.entries(bars))
    for (const b of list) {
      const m = closeAt.get(b.t) ?? {};
      m[t] = b.c;
      closeAt.set(b.t, m);
    }
  const lastPrices: Record<string, number> = {};
  for (const [t, list] of Object.entries(bars)) {
    const b = list.filter((x) => x.t <= run.state.lastBarAt!).at(-1);
    if (b) lastPrices[t] = b.c;
  }
  // A day's value is its last bar's.
  const byDay = new Map<string, { valueCents: number; holdCents: number }>();
  let lastHold = hold ? hold.units * (lastPrices[hold.ticker] ?? 0) : 0;
  for (const v of run.values) {
    const c = closeAt.get(v.at)?.[hold?.ticker ?? ""];
    if (hold && c) lastHold = hold.units * c;
    byDay.set(v.at.slice(0, 10), {
      valueCents: Math.round(v.valueCents),
      holdCents: Math.round(lastHold),
    });
  }
  const positions = positionsAfter(
    Object.fromEntries(account.positions.map((p) => [p.ticker, p])),
    run.trades,
    run.state.units,
  );
  const saved = await client.$transaction(async (tx) => {
    // Only if no other tick moved it on meanwhile.
    const claimed = await tx.paperAccount.updateMany({
      where: { id: account.id, userId, agentLastBarAt: account.agentLastBarAt },
      data: {
        agentLastBarAt: new Date(run.state.lastBarAt!),
        agentState: { state: run.state, hold } as never,
        cashCents: Math.max(0, Math.floor(run.state.cash)),
        prices: { ...(account.prices as Record<string, number>), ...lastPrices },
        pricesDate: new Date(`${run.state.lastBarAt!.slice(0, 10)}T00:00:00Z`),
        priceSource: source.real ? "live" : "sample",
        lastRunAt: now,
      },
    });
    if (claimed.count === 0) return false;
    await tx.paperPosition.deleteMany({ where: { accountId: account.id, userId } });
    if (positions.length > 0)
      await tx.paperPosition.createMany({
        data: positions.map((p) => ({ ...p, accountId: account.id, userId })),
      });
    if (run.trades.length > 0)
      await tx.paperTrade.createMany({
        data: run.trades.map((t) => ({
          accountId: account.id,
          userId,
          placedAt: new Date(t.at),
          ticker: t.ticker,
          side: t.side,
          quantity: t.quantity,
          priceCents: Math.round(t.priceCents),
          amountCents: Math.round(t.amountCents),
          feeCents: Math.round(t.feeCents),
          spreadCents: Math.round(t.spreadCents),
          reason: t.reason,
          source: t.source === "rule" ? "agent" : t.source,
        })),
      });
    for (const [day, v] of byDay) {
      const date = new Date(`${day}T00:00:00Z`);
      await tx.paperValue.upsert({
        where: { accountId_date: { accountId: account.id, date } },
        create: { accountId: account.id, userId, date, ...v },
        update: v,
      });
    }
    return true;
  });
  if (!saved) return none;
  return { ran: true, bars: run.values.length, trades: run.trades.length };
}

// Whether a bar has closed since the agent's last one (opening the page then runs a tick).
export function agentIsStale(
  account: {
    agentInterval: string | null;
    agentLastBarAt: Date | null;
    agentStartedAt: Date | null;
  },
  now: Date,
): boolean {
  if (!account.agentInterval) return false;
  const last = account.agentLastBarAt ?? account.agentStartedAt;
  if (!last) return true;
  return now.getTime() - last.getTime() >= 2 * BAR_MS(account.agentInterval as AgentInterval);
}

// The paper account's own trades (its start, the daily rule's, news ideas) and the switch to cash.
export const NOT_AGENT = ["start", "rule", "news", "agent_start"] as const;

export type AgentView = {
  policy: string;
  label: string;
  interval: AgentInterval;
  intervalLabel: string;
  market: AgentMarketId;
  marketLabel: string;
  startedAt: string;
  lastBarAt: string | null;
  prices: "live" | "sample";
  evidence: EvidenceRow | null;
  trades: {
    id: string;
    at: string;
    ticker: string;
    side: string;
    quantity: number;
    priceCents: number;
    amountCents: number;
    feeCents: number;
    spreadCents: number;
    reason: string;
    source: string;
  }[];
};

// The page's view of the agent: what it runs and its latest trades, from what's stored.
export async function loadAgentView(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<AgentView | null> {
  const db = scopedFor(userId, client);
  const a = await db.paperAccounts.findFirst();
  if (!a?.agentPolicy || !a.agentInterval || !a.agentMarket || !a.agentStartedAt) return null;
  const policy = policyByKey(a.agentPolicy);
  const interval = a.agentInterval as AgentInterval;
  const market = a.agentMarket as AgentMarketId;
  const trades = await db.paperTrades.findMany({
    where: {
      accountId: a.id,
      // Its trades, the warm-up day's included.
      placedAt: { gte: new Date(a.agentStartedAt.getTime() - AGENT_WARMUP_HOURS * 3_600_000) },
      source: { notIn: [...NOT_AGENT] },
    },
    orderBy: { placedAt: "desc" },
    take: 50,
  });
  return {
    policy: a.agentPolicy,
    label: policy?.label ?? a.agentPolicy,
    interval,
    intervalLabel: AGENT_INTERVALS[interval].label,
    market,
    marketLabel: AGENT_MARKETS[market].label,
    startedAt: a.agentStartedAt.toISOString(),
    lastBarAt: a.agentLastBarAt?.toISOString() ?? null,
    prices: a.priceSource === "live" ? "live" : "sample",
    evidence: evidenceFor(market, interval, a.agentPolicy),
    trades: trades.map((t) => ({
      id: t.id,
      at: t.placedAt.toISOString(),
      ticker: t.ticker,
      side: t.side,
      quantity: t.quantity,
      priceCents: t.priceCents,
      amountCents: t.amountCents,
      feeCents: t.feeCents,
      spreadCents: t.spreadCents,
      reason: t.reason,
      source: t.source,
    })),
  };
}
