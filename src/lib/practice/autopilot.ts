import { CRYPTO_SLEEVE_HISTORY_DAYS } from "@/config/crypto-strategies";
import { SESSION_CLOSE_MINUTE } from "@/config/intraday-strategies";
import type { RiskLevel } from "@/config/investing";
import { CATALOG, CATALOG_MIX_FUNDS, type CatalogId } from "@/config/strategy-catalog";
import type { Bar } from "@/lib/market/types";
import {
  CRYPTO_TICKERS,
  DAY_TRADE_TICKER,
  LEDGER_UNIVERSE,
  PRACTICE_UNIVERSE,
  THEME_FUNDS,
} from "@/config/portfolios";
import { rulesOnAt } from "@/config/practice-scan";
import { WASH_SALE_DAYS } from "@/config/tax-rates";
import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { intradaySession, marketData } from "@/lib/market";
import {
  monthlyDue,
  planTrades,
  portfolioValue,
  sellsFirst,
  withinHard,
  type PlannedTrade,
} from "@/planning/practice-autopilot";
import { cryptoSleeveTrades, previousWeekday, sleeveCash } from "@/planning/crypto-sleeve";
import { dayTradeFills, dayTradeReserve, type DayTradeSleeve } from "@/planning/day-trade";
import { catalogTargets, planTargets, type FollowTargets } from "@/planning/catalog-follow";
import { alignCatalog } from "@/planning/catalog/engine";
import { sessionsOf } from "@/planning/intraday";
import { refusedByPreferences, type PracticeProfile } from "@/planning/practice-profile";
import { washBlocked } from "@/planning/practice-scan";
import { themeExits } from "@/planning/themes";
import { replay, type Entry } from "@/planning/practice-ledger";
import { practiceBroker, loadLedger, type Fill } from "./broker";
import { addPracticeMoney, PracticeError } from "./portfolio";
import { practiceProfileOf } from "./preferences";

// Autopilot for the practice portfolio (spec steps 291 and 294, Phase AW, Stage A): once a level
// is chosen Jane buys the model, rebalances past the band and adds the monthly practice money,
// in the paper ledger only. A pause switch stops it before the next run; every trade has a reason
// and a rule and is audit-logged; the person can see the log and undo the last trade. Nothing here
// touches a real account.

type Options = { client?: PrismaClient; now?: Date };

// In suggest-only mode (the person's preferences) the plan comes back as `suggested` and nothing
// is placed.
export type RunResult =
  | { ran: false; why: "no_portfolio" | "paused" }
  | { ran: true; deposit: boolean; fills: Fill[]; suggested: PlannedTrade[] };

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

// The monthly practice money, once a month, on or after the chosen day. True when it went in.
// The daily run puts it in before the scan (step 292), so a dip can use it first.
export async function addMonthlyIfDue(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const { portfolio } = await loadLedger(userId, client);
  if (portfolio.paused) return false;
  const today = now.toISOString().slice(0, 10);
  const due = { ...portfolio, today, addedThisMonth: false };
  if (!monthlyDue(due)) return false;
  const added = await client.practiceTrade.findFirst({
    where: {
      portfolioId: portfolio.id,
      side: "deposit",
      rule: "monthly_add",
      undone: false,
      placedAt: { gte: new Date(`${monthKey(now)}-01T00:00:00Z`) },
    },
    select: { id: true },
  });
  if (!monthlyDue({ ...due, addedThisMonth: added !== null })) return false;
  await addPracticeMoney(
    userId,
    portfolio.monthlyAddCents,
    "Your monthly practice money.",
    "monthly_add",
    { client, now },
  );
  return true;
}

export async function runAutopilot(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<RunResult> {
  let ledger;
  try {
    ledger = await loadLedger(userId, client);
  } catch {
    return { ran: false, why: "no_portfolio" };
  }
  const { portfolio } = ledger;
  if (portfolio.paused) return { ran: false, why: "paused" };

  const deposit = await addMonthlyIfDue(userId, { client, now });

  const { state } = await loadLedger(userId, client);
  const asOf = now.toISOString().slice(0, 10);
  const feed = marketData();
  const prices: Record<string, number> = {};
  for (const ticker of PRACTICE_UNIVERSE) {
    const bar = await feed.latest(ticker, asOf);
    if (bar) prices[ticker] = bar.closeCents;
  }
  const dayStart = new Date(`${asOf}T00:00:00Z`);
  const tradesToday = await client.practiceTrade.count({
    where: {
      portfolioId: portfolio.id,
      side: { in: ["buy", "sell"] },
      undone: false,
      placedAt: { gte: dayStart },
    },
  });
  // Funds sold at a loss lately aren't bought back (no wash sale).
  const recent = await client.practiceTrade.findMany({
    where: {
      portfolioId: portfolio.id,
      side: "sell",
      undone: false,
      placedAt: { gte: new Date(dayStart.getTime() - (WASH_SALE_DAYS + 1) * 86_400_000) },
    },
    select: { placedAt: true, side: true, ticker: true, gainCents: true },
  });
  const sold = recent.map((t) => ({ ...t, placedAt: t.placedAt.toISOString() }));
  const blocked = washBlocked(sold, asOf);
  // The person's preferences: the mix, what is never bought, the cash kept and whether Jane acts.
  const profile = await practiceProfileOf(userId, { client, now });
  // A news theme's slice comes out after its month, or at its stop (src/planning/themes.ts).
  const themeBuys = await client.practiceTrade.findMany({
    where: {
      portfolioId: portfolio.id,
      side: "buy",
      undone: false,
      ticker: { in: [...THEME_FUNDS] },
    },
    select: {
      placedAt: true,
      side: true,
      ticker: true,
      quantity: true,
      amountCents: true,
      rule: true,
    },
  });
  const exits = themeExits(
    state,
    prices,
    themeBuys.map((t) => ({ ...t, placedAt: t.placedAt.toISOString() })),
    asOf,
  );
  // The crypto sleeve (Very high only, src/planning/crypto-sleeve.ts): its coins priced only
  // while it runs or holds them, and its trades before the mix's, whose cash they change.
  const holdsCrypto = CRYPTO_TICKERS.some((t) => (state.positions[t]?.quantity ?? 0) > 0);
  const history: Record<string, number[]> = {};
  if (profile.crypto || holdsCrypto) {
    const before = previousWeekday(asOf);
    const from = new Date(dayStart.getTime() - CRYPTO_SLEEVE_HISTORY_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    for (const t of CRYPTO_TICKERS) {
      const bar = await feed.latest(t, asOf);
      if (bar) prices[t] = bar.closeCents;
      if (profile.crypto)
        history[t] = (await feed.prices(t, from, before)).map((b) => b.closeCents);
    }
  }
  // The day-trading sleeve's money stays in cash for it (src/planning/day-trade.ts).
  const reserve = dayTradeReserve(profile.dayTrade, portfolioValue(state, prices));
  const sleeve = cryptoSleeveTrades({
    sleeve: profile.crypto,
    level: profile.level,
    state,
    prices,
    history,
    today: asOf,
    previous: previousWeekday(asOf),
    cashCents: state.cashCents - profile.cashBufferCents - reserve,
    traded:
      profile.crypto !== null &&
      (await client.practiceTrade.count({
        where: { portfolioId: portfolio.id, rule: "crypto_sleeve", undone: false },
      })) > 0,
  });
  // A tested strategy followed instead of the mix (src/planning/catalog-follow.ts): its own rule
  // on the last year and a half of its funds' closes.
  const follow = profile.catalog ? await followTargets(profile.catalog, profile.level, asOf) : null;
  const rest = follow
    ? planTargets({
        label: CATALOG[profile.catalog!.id].label,
        targets: follow.targets,
        signalDate: follow.signalDate,
        state: { ...state, cashCents: state.cashCents + sleeveCash(sleeve) },
        prices: { ...prices, ...follow.prices },
        cashBufferCents: profile.cashBufferCents + reserve,
        tradesToday: tradesToday + exits.length + sleeve.length,
        limits: profile.limits,
      })
    : null;
  const plan = rest
    ? [...exits, ...sleeve, ...rest]
    : [
        ...exits,
        ...sleeve,
        ...planTrades({
          level: profile.level,
          state: { ...state, cashCents: state.cashCents + sleeveCash(sleeve) },
          prices,
          paused: false,
          tradesToday: tradesToday + exits.length + sleeve.length,
          blocked,
          weights: profile.weights,
          avoid: new Set(profile.avoid),
          cashBufferCents: profile.cashBufferCents + reserve,
          limits: profile.limits,
          harvesting: profile.harvestLosses && rulesOnAt(profile.level).has("tax_loss_harvest"),
          funds: profile.funds,
        }),
      ];
  if (!profile.trades) return { ran: true, deposit, fills: [], suggested: plan };
  const broker = practiceBroker();
  const fills: Fill[] = [];
  for (const t of sellsFirst(plan)) {
    if (refusedByPreferences(profile, t)) continue;
    fills.push(
      await broker.placeOrder(
        userId,
        {
          ticker: t.ticker,
          side: t.side,
          amountCents: t.amountCents,
          reason: t.reason,
          rule: t.rule,
        },
        { client, now },
      ),
    );
  }
  if (profile.dayTrade) {
    fills.push(
      ...(await dayTrade(userId, profile.dayTrade, tradesToday + fills.length, profile.limits, {
        client,
        now,
      })),
    );
  }
  return { ran: true, deposit, fills, suggested: [] };
}

// A followed catalog strategy's targets this month, from its funds' closes over the last year and
// a half, and their latest prices.
async function followTargets(
  choice: { id: CatalogId; param: number },
  level: RiskLevel,
  asOf: string,
): Promise<(FollowTargets & { prices: Record<string, number> }) | null> {
  const feed = marketData();
  const tickers = [
    ...new Set([...CATALOG[choice.id].tickers, ...Object.values(CATALOG_MIX_FUNDS)]),
  ];
  const from = new Date(Date.parse(`${asOf}T00:00:00Z`) - FOLLOW_HISTORY_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const bars: Record<string, Bar[]> = {};
  for (const t of tickers) bars[t] = await feed.prices(t, from, asOf);
  const u = alignCatalog(bars);
  if (!u) return null;
  const f = catalogTargets(choice.id, choice.param, u, level);
  if (!f) return null;
  const prices = Object.fromEntries(
    Object.keys(f.targets).flatMap((t) => {
      const c = u.closes[t]?.at(-1);
      return c ? [[t, c]] : [];
    }),
  );
  return { ...f, prices };
}

// How far back a followed strategy's closes are read: its longest look-back (a year of months
// and a year of daily volatility) with room for holidays.
const FOLLOW_HISTORY_DAYS = 560;

// The day's trade for the day-trading sleeve, after the close: the rule on the day's own
// 5-minute bars, bought and sold at their prices with the slippage in. Once a day, only on a
// whole session, and only within the day's trade limit.
async function dayTrade(
  userId: string,
  sleeve: DayTradeSleeve,
  tradesSoFar: number,
  limits: PracticeProfile["limits"],
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Fill[]> {
  const day = now.toISOString().slice(0, 10);
  const { portfolio, state } = await loadLedger(userId, client);
  const done = await client.practiceTrade.count({
    where: {
      portfolioId: portfolio.id,
      rule: "day_trade",
      undone: false,
      placedAt: { gte: new Date(`${day}T00:00:00Z`) },
    },
  });
  if (done > 0 || tradesSoFar + 2 > withinHard(limits).tradesPerDay) return [];
  const session = intradaySession();
  const [today] = sessionsOf(await session(DAY_TRADE_TICKER, day));
  if (!today || today.bars.at(-1)!.minute < SESSION_CLOSE_MINUTE - 5) return [];
  const [prior] = sessionsOf(await session(DAY_TRADE_TICKER, previousWeekday(day)));
  const prices: Record<string, number> = { [DAY_TRADE_TICKER]: today.bars.at(-1)!.c };
  for (const t of Object.keys(state.positions)) {
    const bar = await marketData().latest(t, day);
    if (bar) prices[t] = bar.closeCents;
  }
  const planned = dayTradeFills({
    sleeve,
    today,
    prior: prior ?? null,
    portfolioCents: portfolioValue(state, prices),
    cashCents: state.cashCents,
  });
  const broker = practiceBroker();
  const out: Fill[] = [];
  for (const f of planned) out.push(await broker.placeOrder(userId, f, { client, now }));
  return out;
}

// The pause switch: the whole portfolio, or opportunities alone (step 292). Takes effect before
// the next run.
export async function setPaused(
  userId: string,
  which: "all" | "opportunities",
  paused: boolean,
  { client = defaultClient }: Options = {},
) {
  const { portfolio } = await loadLedger(userId, client);
  await client.practicePortfolio.update({
    where: { id: portfolio.id },
    data: which === "all" ? { paused } : { opportunitiesPaused: paused },
  });
  await logAudit(
    { type: "user", id: userId },
    "practice_trade",
    { type: "practice_portfolio", id: portfolio.id },
    {
      side: paused ? "pause" : "resume",
      rule: which,
      simulated: "true",
    },
  );
}

export type LogRow = {
  id: string;
  placedAt: Date;
  side: string;
  ticker: string | null;
  amountCents: number;
  priceCents: number | null;
  gainCents: number | null;
  reason: string;
  rule: string;
  undone: boolean;
};

export async function tradeLog(
  userId: string,
  { client = defaultClient, limit = 50 }: { client?: PrismaClient; limit?: number } = {},
): Promise<LogRow[]> {
  return scopedFor(userId, client).practiceTrades.findMany({
    orderBy: [{ placedAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      placedAt: true,
      side: true,
      ticker: true,
      amountCents: true,
      priceCents: true,
      gainCents: true,
      reason: true,
      rule: true,
      undone: true,
    },
  });
}

// Undo the latest trade (practice only): it is marked undone and the ledger is rebuilt from
// every trade that stands. The starting money can't be undone.
export async function undoLastTrade(userId: string, { client = defaultClient }: Options = {}) {
  const { portfolio } = await loadLedger(userId, client);
  const last = await client.practiceTrade.findFirst({
    where: { portfolioId: portfolio.id, undone: false, rule: { not: "start" } },
    orderBy: [{ placedAt: "desc" }, { id: "desc" }],
  });
  if (!last) throw new PracticeError("There's nothing to undo.");
  const standing = await client.practiceTrade.findMany({
    where: { portfolioId: portfolio.id, undone: false, id: { not: last.id } },
    orderBy: [{ placedAt: "asc" }, { id: "asc" }],
  });
  const entries: Entry[] = standing.map((t) =>
    t.side === "deposit"
      ? { side: "deposit", amountCents: t.amountCents }
      : {
          side: t.side as "buy" | "sell",
          ticker: t.ticker!,
          amountCents: t.amountCents,
          priceCents: t.priceCents!,
        },
  );
  const rebuilt = replay(0, entries, LEDGER_UNIVERSE);
  await client.$transaction([
    client.practiceTrade.update({ where: { id: last.id }, data: { undone: true } }),
    client.practicePortfolio.update({
      where: { id: portfolio.id },
      data: { cashCents: rebuilt.cashCents },
    }),
    client.practicePosition.deleteMany({ where: { portfolioId: portfolio.id } }),
    client.practicePosition.createMany({
      data: Object.entries(rebuilt.positions).map(([ticker, p]) => ({
        portfolioId: portfolio.id,
        userId,
        ticker,
        quantity: p.quantity,
        costBasisCents: p.costBasisCents,
      })),
    }),
  ]);
  await logAudit(
    { type: "user", id: userId },
    "practice_trade",
    { type: "practice_trade", id: last.id },
    {
      side: "undo",
      rule: last.rule,
      simulated: "true",
    },
  );
  return { undone: last.id, side: last.side, ticker: last.ticker };
}
