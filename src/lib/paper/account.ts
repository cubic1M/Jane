import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import {
  PAPER_BAND,
  PAPER_MAX_START_CENTS,
  PAPER_MIN_START_CENTS,
  PAPER_MIN_TRADE_CENTS,
  PAPER_RULE_CONFIDENCE,
  PAPER_RUN_EVERY_HOURS,
} from "@/config/paper";
import { STRATEGY_LABELS, STRATEGY_RESEARCH_CHOICE } from "@/config/strategies";
import { CATALOG, type CatalogId } from "@/config/strategy-catalog";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { strategyBoard } from "@/lib/investments/strategy-board";
import { practiceProfileOf } from "@/lib/practice/preferences";
import {
  fill,
  holdUnits,
  holdValue,
  mixWeights,
  ordersToward,
  revert,
  value,
  type PaperOrder,
} from "@/planning/paper";
import type { LedgerState } from "@/planning/practice-ledger";
import { agentIsStale, tickTradingAgent } from "@/lib/trading-agent/agent";
// The events overlay's signals for the agent's ticks (registers itself when loaded).
import "@/lib/events/agent-source";
import { latestCloses, paperPrices, type PaperPrices } from "./prices";
import { strategyTargets } from "./targets";

// The paper account (2026-10-26): simulated money the person starts from the investments page,
// run by the strategy they picked ("Use this strategy") on real daily closes. Each day after the
// close (Vercel Cron) it is valued, and when the strategy's rule asks for a trade, or a news idea
// comes up, a trade waits in the trade pop-up: Paper trade it (instant, revertable) or Skip.
// Nothing here places a real order or touches a real account. Demo advice only: the strategies,
// the news ideas and the trades are Jane's recommendations, which real accounts never get
// (REAL_ACCOUNT_ADVICE), so the whole account is for advice mode.

type Options = { client?: PrismaClient; now?: Date; prices?: PaperPrices };

export class PaperError extends Error {}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const pct = (n: number) => `${Math.round(n * 100)}%`;

// The investments page's key for what the practice portfolio runs: a tested strategy, else Jane's
// pick for the level.
export async function strategyOf(userId: string, { client = defaultClient, now }: Options = {}) {
  const profile = await practiceProfileOf(userId, { client, now });
  const key = profile.catalog ? `catalog:${profile.catalog.id}` : "default";
  return { key, level: profile.level };
}

export function strategyLabel(key: string, level: RiskLevel): string {
  if (key.startsWith("catalog:")) return CATALOG[key.slice(8) as CatalogId]?.label ?? key;
  const choice = STRATEGY_RESEARCH_CHOICE[level];
  return choice.id === "static"
    ? "Your level's mix"
    : `Jane's pick (${STRATEGY_LABELS[choice.id]})`;
}

// How sure a rule's trade is: how the research rates the strategy at the level.
function ruleConfidence(key: string, level: RiskLevel): number {
  const row = strategyBoard({
    level,
    yourLevel: level,
    choice: "level",
    catalog: null,
    crypto: null,
    dayTrading: null,
  }).rows.find((r) => r.key === key);
  return PAPER_RULE_CONFIDENCE[row?.status ?? "tested"];
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadAccount>>>;

async function loadAccount(userId: string, client: PrismaClient) {
  return scopedFor(userId, client).paperAccounts.findFirst({
    include: { positions: true },
  });
}

const stateOf = (a: Loaded): LedgerState => ({
  cashCents: a.cashCents,
  positions: Object.fromEntries(
    a.positions.map((p) => [p.ticker, { quantity: p.quantity, costBasisCents: p.costBasisCents }]),
  ),
});

// Writes a state's positions over the account's (in a transaction).
async function savePositions(
  tx: Pick<PrismaClient, "paperPosition">,
  userId: string,
  accountId: string,
  state: LedgerState,
) {
  await tx.paperPosition.deleteMany({ where: { accountId, userId } });
  const rows = Object.entries(state.positions).filter(([, p]) => p.quantity > 1e-9);
  if (rows.length > 0)
    await tx.paperPosition.createMany({
      data: rows.map(([ticker, p]) => ({
        accountId,
        userId,
        ticker,
        quantity: p.quantity,
        costBasisCents: p.costBasisCents,
      })),
    });
}

export async function startPaperAccount(
  userId: string,
  startingCents: number,
  { client = defaultClient, now = new Date(), prices }: Options = {},
): Promise<string> {
  if (!(await adviceMode(userId, { client })))
    throw new PaperError("The paper account runs on the demo bank only for now.");
  const db = scopedFor(userId, client);
  if (await db.paperAccounts.findFirst({ select: { id: true } }))
    throw new PaperError("You already have a paper account.");
  if (
    !Number.isInteger(startingCents) ||
    startingCents < PAPER_MIN_START_CENTS ||
    startingCents > PAPER_MAX_START_CENTS
  )
    throw new PaperError("Pick a starting balance from $100 to $1,000,000.");
  const source = prices ?? paperPrices();
  const asOf = dayOf(now);
  const { key, level } = await strategyOf(userId, { client, now });
  const label = strategyLabel(key, level);
  const t = (await strategyTargets(key, level, asOf, source)) ?? {
    targets: mixWeights(level),
    signalDate: asOf,
  };
  const latest = await latestCloses(
    source,
    [...Object.keys(t.targets), ...Object.keys(mixWeights(level))],
    asOf,
  );
  if (!latest.date) throw new PaperError("Prices aren't available right now. Try again later.");
  let state: LedgerState = { cashCents: startingCents, positions: {} };
  const fills: (PaperOrder & { priceCents: number; quantity: number })[] = [];
  for (const o of ordersToward(t.targets, state, latest.prices, {
    band: 0,
    minTradeCents: PAPER_MIN_TRADE_CENTS,
  })) {
    const done = fill(state, o, latest.prices[o.ticker]);
    state = done.state;
    fills.push({ ...o, priceCents: latest.prices[o.ticker], quantity: done.quantity ?? 0 });
  }
  const hold = holdUnits(level, startingCents, latest.prices);
  const account = await client.$transaction(async (tx) => {
    const a = await tx.paperAccount.create({
      data: {
        userId,
        startingCents,
        cashCents: state.cashCents,
        level,
        strategy: key,
        priceSource: source.name,
        hold,
        prices: latest.prices,
        pricesDate: new Date(`${latest.date}T00:00:00Z`),
        startedAt: now,
        lastRunAt: now,
      },
      select: { id: true },
    });
    await savePositions(tx, userId, a.id, state);
    if (fills.length > 0)
      await tx.paperTrade.createMany({
        data: fills.map((f) => ({
          accountId: a.id,
          userId,
          placedAt: now,
          ticker: f.ticker,
          side: f.side,
          quantity: f.quantity,
          priceCents: f.priceCents,
          amountCents: f.amountCents,
          reason: `Started: ${label} holds ${pct(t.targets[f.ticker] ?? 0)} in ${f.ticker}.`,
          source: "start",
        })),
      });
    await tx.paperValue.create({
      data: {
        accountId: a.id,
        userId,
        date: new Date(`${latest.date}T00:00:00Z`),
        valueCents: value(state, latest.prices),
        holdCents: holdValue(hold, latest.prices),
      },
    });
    return a;
  });
  await logAudit(
    { type: "user", id: userId },
    "paper_account_started",
    { type: "paper_account", id: account.id },
    { level, strategy: key, startingCents, prices: source.name, simulated: "true" },
  );
  await track(userId, "paper_account_started", { level, strategy: key, prices: source.name });
  return account.id;
}

export type RunReport = { ran: boolean; signals: number };

// A day of the paper account: valued at the last closes, and the trades its strategy's rule asks
// for (and any new news idea) left in the trade pop-up. Safe to run again: a day's value is
// written once, and each signal once (its key).
export async function runPaperDay(
  userId: string,
  { client = defaultClient, now = new Date(), prices }: Options = {},
): Promise<RunReport> {
  const account = await loadAccount(userId, client);
  if (!account || !(await adviceMode(userId, { client }))) return { ran: false, signals: 0 };
  // The 24-hour agent runs the account instead (src/lib/trading-agent/agent.ts): its catch-up
  // replays every bar since the last, and the daily rule's pop-up trades wait while it runs.
  if (account.agentPolicy) {
    const tick = await tickTradingAgent(userId, { client, now });
    return { ran: tick.ran, signals: 0 };
  }
  const db = scopedFor(userId, client);
  const source = prices ?? paperPrices();
  const asOf = dayOf(now);
  const { key, level } = await strategyOf(userId, { client, now });
  const label = strategyLabel(key, level);
  const t = await strategyTargets(key, level, asOf, source);
  const hold = account.hold as Record<string, number>;
  const state = stateOf(account);
  // Recent news ideas from the practice scan (the existing news-driven alerts).
  const news = await db.practiceOpportunities.findMany({
    where: {
      kind: "theme_idea",
      scannedAt: { gt: new Date(now.getTime() - 2 * 86_400_000), lte: now },
    },
    select: { key: true, ticker: true, amountCents: true, reason: true, confidence: true },
  });
  const latest = await latestCloses(
    source,
    [
      ...Object.keys(t?.targets ?? {}),
      ...Object.keys(state.positions),
      ...Object.keys(hold),
      ...news.map((n) => n.ticker),
    ],
    asOf,
  );
  if (!latest.date) return { ran: false, signals: 0 };
  const date = new Date(`${latest.date}T00:00:00Z`);
  const valueCents = value(state, latest.prices);
  await db.paperValues.upsert({
    where: { accountId_date: { accountId: account.id, date } },
    create: {
      accountId: account.id,
      userId,
      date,
      valueCents,
      holdCents: holdValue(hold, latest.prices),
    },
    update: { valueCents, holdCents: holdValue(hold, latest.prices) },
  });
  type Wanted = Omit<PaperOrder, "side"> & {
    side: string;
    key: string;
    source: string;
    reason: string;
    confidence: number;
  };
  const wanted: Wanted[] = [];
  if (t) {
    // A new month's decision replaces the last one's waiting trades.
    await db.paperSignals.updateMany({
      where: {
        accountId: account.id,
        source: "rule",
        status: "open",
        NOT: { key: { startsWith: `rule:${t.signalDate}:` } },
      },
      data: { status: "expired", decidedAt: now },
    });
    const confidence = ruleConfidence(key, level);
    for (const o of ordersToward(t.targets, state, latest.prices, {
      band: PAPER_BAND,
      minTradeCents: PAPER_MIN_TRADE_CENTS,
    }))
      wanted.push({
        ...o,
        key: `rule:${t.signalDate}:${o.ticker}:${o.side}`,
        source: "rule",
        confidence,
        reason:
          o.ticker in t.targets
            ? `${label}'s rule at the close on ${t.signalDate}: ${o.ticker} ${o.side === "buy" ? "up" : "down"} to ${pct(t.targets[o.ticker])} of the account.`
            : `${label}'s rule at the close on ${t.signalDate}: it holds no ${o.ticker} this month.`,
      });
  }
  for (const n of news) {
    const amount = Math.min(n.amountCents, state.cashCents);
    if (!latest.prices[n.ticker] || amount < PAPER_MIN_TRADE_CENTS) continue;
    wanted.push({
      ticker: n.ticker,
      side: "buy",
      amountCents: amount,
      key: `news:${n.key}`,
      source: "news",
      confidence: n.confidence,
      reason: n.reason.endsWith(".") ? n.reason : `${n.reason}.`,
    });
  }
  let signals = 0;
  for (const w of wanted) {
    const exists = await db.paperSignals.findFirst({
      where: { accountId: account.id, key: w.key },
      select: { id: true },
    });
    if (exists) continue;
    await db.paperSignals.create({
      data: {
        accountId: account.id,
        userId,
        createdAt: now,
        key: w.key,
        source: w.source,
        ticker: w.ticker,
        side: w.side,
        amountCents: w.amountCents,
        priceCents: latest.prices[w.ticker],
        reason: w.reason,
        confidence: w.confidence,
        status: "open",
      },
    });
    signals += 1;
  }
  await db.paperAccounts.update({
    where: { id: account.id },
    data: {
      strategy: key,
      level,
      prices: { ...(account.prices as Record<string, number>), ...latest.prices },
      pricesDate: date,
      lastRunAt: now,
    },
  });
  return { ran: true, signals };
}

// Opening the investments page runs a stale account, after the page is sent.
export async function runPaperIfStale(userId: string, options: Options = {}) {
  const now = options.now ?? new Date();
  const client = options.client ?? defaultClient;
  const a = await scopedFor(userId, client).paperAccounts.findFirst({
    select: { lastRunAt: true, agentInterval: true, agentLastBarAt: true, agentStartedAt: true },
  });
  if (!a) return;
  // The 24-hour agent: whenever a bar has closed since its last.
  if (a.agentInterval) {
    if (!agentIsStale(a, now)) return;
  } else if (
    a.lastRunAt &&
    now.getTime() - a.lastRunAt.getTime() < PAPER_RUN_EVERY_HOURS * 3_600_000
  )
    return;
  try {
    await runPaperDay(userId, options);
  } catch (error) {
    console.error("The paper account's run failed", { error: String(error) });
  }
}

// Vercel Cron, after the close: every paper account, one at a time; one failing stops none.
export async function runPaperDayForAll({
  client = defaultClient,
  now = new Date(),
}: Options = {}) {
  const accounts = await client.paperAccount.findMany({ select: { userId: true } });
  let ran = 0;
  let failed = 0;
  for (const { userId } of accounts) {
    try {
      if ((await runPaperDay(userId, { client, now })).ran) ran += 1;
    } catch (error) {
      failed += 1;
      console.error("A paper account's run failed", { error: String(error) });
    }
  }
  return { accounts: accounts.length, ran, failed };
}

export type TakeResult = { ok: true; tradeId: string } | { ok: false; error: string };

// "Paper trade it": the signal's trade at its price, at once.
export async function takeSignal(
  userId: string,
  signalId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<TakeResult> {
  if (!(await adviceMode(userId, { client })))
    return { ok: false, error: "The paper account runs on the demo bank only for now." };
  const db = scopedFor(userId, client);
  const signal = await db.paperSignals.findFirst({ where: { id: signalId, status: "open" } });
  const account = await loadAccount(userId, client);
  if (!signal || !account || signal.accountId !== account.id)
    return { ok: false, error: "That trade isn't waiting any more." };
  // While the 24-hour agent runs the account, it alone trades it: a trade from outside would
  // leave its state behind. The events overlay reaches it as signals (registerAgentSignals).
  if (account.agentPolicy)
    return { ok: false, error: "The 24-hour agent runs this account; stop it to trade by hand." };
  const state = stateOf(account);
  const heldCents = Math.floor((state.positions[signal.ticker]?.quantity ?? 0) * signal.priceCents);
  const amount =
    signal.side === "buy"
      ? Math.min(signal.amountCents, state.cashCents)
      : Math.min(signal.amountCents, heldCents);
  if (amount < 1)
    return {
      ok: false,
      error:
        signal.side === "buy"
          ? "Not enough paper cash for it."
          : `No ${signal.ticker} left to sell.`,
    };
  const done = fill(
    state,
    { ticker: signal.ticker, side: signal.side as "buy" | "sell", amountCents: amount },
    signal.priceCents,
  );
  const trade = await client.$transaction(async (tx) => {
    await tx.paperAccount.update({
      where: { id: account.id, userId },
      data: { cashCents: done.state.cashCents },
    });
    await savePositions(tx, userId, account.id, done.state);
    const tr = await tx.paperTrade.create({
      data: {
        accountId: account.id,
        userId,
        placedAt: now,
        ticker: signal.ticker,
        side: signal.side,
        quantity: done.quantity ?? 0,
        priceCents: signal.priceCents,
        amountCents: amount,
        reason: signal.reason,
        source: signal.source,
        signalId: signal.id,
      },
      select: { id: true },
    });
    await tx.paperSignal.update({
      where: { id: signal.id, userId },
      data: { status: "taken", decidedAt: now },
    });
    return tr;
  });
  await logAudit(
    { type: "user", id: userId },
    "paper_trade_taken",
    { type: "paper_trade", id: trade.id },
    {
      ticker: signal.ticker,
      side: signal.side,
      amountCents: amount,
      source: signal.source,
      simulated: "true",
    },
  );
  await track(userId, "paper_trade_taken", { source: signal.source, side: signal.side });
  return { ok: true, tradeId: trade.id };
}

export async function skipSignal(
  userId: string,
  signalId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ ok: boolean }> {
  const db = scopedFor(userId, client);
  const changed = await db.paperSignals.updateMany({
    where: { id: signalId, status: "open" },
    data: { status: "skipped", decidedAt: now },
  });
  if (changed.count === 0) return { ok: false };
  await logAudit(
    { type: "user", id: userId },
    "paper_signal_skipped",
    { type: "paper_signal", id: signalId },
    { simulated: "true" },
  );
  await track(userId, "paper_signal_skipped", {});
  return { ok: true };
}

// Revert: the trade taken back at its own price; its signal waits in the pop-up again.
export async function revertTrade(
  userId: string,
  tradeId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = scopedFor(userId, client);
  const trade = await db.paperTrades.findFirst({ where: { id: tradeId, revertedAt: null } });
  const account = await loadAccount(userId, client);
  if (!trade || !account || trade.accountId !== account.id || trade.source === "start")
    return { ok: false, error: "That trade can't be taken back." };
  // The 24-hour agent's trades are its own: taking one back would leave it holding what it didn't
  // decide. Stop the agent to trade by hand.
  if (
    account.agentPolicy &&
    (!["rule", "news"].includes(trade.source) ||
      (account.agentStartedAt !== null && trade.placedAt >= account.agentStartedAt))
  )
    return { ok: false, error: "The 24-hour agent's trades can't be taken back while it runs." };
  let done;
  try {
    done = revert(stateOf(account), {
      ticker: trade.ticker,
      side: trade.side as "buy" | "sell",
      amountCents: trade.amountCents,
      priceCents: trade.priceCents,
    });
  } catch {
    return { ok: false, error: "Later trades changed it, so it can't be taken back." };
  }
  await client.$transaction(async (tx) => {
    await tx.paperAccount.update({
      where: { id: account.id, userId },
      data: { cashCents: done.state.cashCents },
    });
    await savePositions(tx, userId, account.id, done.state);
    await tx.paperTrade.update({ where: { id: trade.id, userId }, data: { revertedAt: now } });
    if (trade.signalId)
      await tx.paperSignal.update({
        where: { id: trade.signalId, userId },
        data: { status: "open", decidedAt: null },
      });
  });
  await logAudit(
    { type: "user", id: userId },
    "paper_trade_reverted",
    { type: "paper_trade", id: trade.id },
    { simulated: "true" },
  );
  await track(userId, "paper_trade_reverted", {});
  return { ok: true };
}

export type PaperView = {
  startingCents: number;
  cashCents: number;
  valueCents: number;
  holdCents: number;
  level: RiskLevel;
  levelLabel: string;
  strategy: string;
  priceSource: string;
  pricesDate: string | null;
  startedAt: string;
  values: { date: string; valueCents: number; holdCents: number }[];
  positions: { ticker: string; quantity: number; valueCents: number; costBasisCents: number }[];
  trades: {
    id: string;
    date: string;
    ticker: string;
    side: string;
    amountCents: number;
    priceCents: number;
    reason: string;
    source: string;
    reverted: boolean;
  }[];
};

// The page's view, from what's stored: no price is fetched.
export async function loadPaperView(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<PaperView | null> {
  const db = scopedFor(userId, client);
  const account = await loadAccount(userId, client);
  if (!account) return null;
  const [values, trades] = await Promise.all([
    db.paperValues.findMany({
      where: { accountId: account.id },
      orderBy: { date: "asc" },
      select: { date: true, valueCents: true, holdCents: true },
    }),
    db.paperTrades.findMany({ where: { accountId: account.id }, orderBy: { placedAt: "desc" } }),
  ]);
  const prices = account.prices as Record<string, number>;
  const state = stateOf(account);
  const level = account.level as RiskLevel;
  return {
    startingCents: account.startingCents,
    cashCents: account.cashCents,
    valueCents: value(state, prices),
    holdCents: holdValue(account.hold as Record<string, number>, prices),
    level,
    levelLabel: RISK_LEVELS[level].label,
    strategy: strategyLabel(account.strategy, level),
    priceSource: account.priceSource,
    pricesDate: account.pricesDate ? dayOf(account.pricesDate) : null,
    startedAt: account.startedAt.toISOString(),
    values: values.map((v) => ({
      date: dayOf(v.date),
      valueCents: v.valueCents,
      holdCents: v.holdCents,
    })),
    positions: account.positions
      .map((p) => ({
        ticker: p.ticker,
        quantity: p.quantity,
        costBasisCents: p.costBasisCents,
        valueCents: Math.round(p.quantity * (prices[p.ticker] ?? 0)),
      }))
      .sort((a, b) => b.valueCents - a.valueCents),
    trades: trades.map((t) => ({
      id: t.id,
      date: dayOf(t.placedAt),
      ticker: t.ticker,
      side: t.side,
      amountCents: t.amountCents,
      priceCents: t.priceCents,
      reason: t.reason,
      source: t.source,
      reverted: t.revertedAt !== null,
    })),
  };
}
