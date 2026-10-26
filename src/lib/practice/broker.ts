import { LEDGER_UNIVERSE } from "@/config/portfolios";
import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { marketData } from "@/lib/market";
import { apply, LedgerError, type LedgerState } from "@/planning/practice-ledger";
import { cachedCopy } from "@/lib/read-cache";

// The practice broker (spec step 290, Phase AW, Stage A). A Broker places orders and reports
// positions; the only implementation is the paper one, which writes to the practice ledger in the
// database and prices every trade from the market data. It never imports the brokerage
// stand-in or any real account: Stage B swaps a licensed partner in behind this interface
// (docs/spec.md, Phase AW).

type Options = { client?: PrismaClient; now?: Date };

export type Order = {
  ticker: string;
  side: "buy" | "sell";
  amountCents: number;
  // One sentence for the person, and the name of the rule that allowed it.
  reason: string;
  rule: string;
  // A day trade's fill at its own price from the day's 5-minute bars (src/planning/day-trade.ts);
  // every other order fills at the day's close.
  priceCents?: number;
};

export type Fill = {
  tradeId: string;
  ticker: string;
  side: "buy" | "sell";
  amountCents: number;
  priceCents: number;
  quantity: number;
  gainCents: number | null;
  simulated: true;
};

export interface Broker {
  readonly name: string;
  readonly simulated: boolean;
  placeOrder(userId: string, order: Order, options?: Options): Promise<Fill>;
  positions(
    userId: string,
    options?: Options,
  ): Promise<{ ticker: string; quantity: number; costBasisCents: number }[]>;
}

export class NoPracticePortfolio extends Error {}

// Read once until the next trade in a sync's practice replay (src/lib/read-cache.ts): each day's
// scan and autopilot ask for it several times.
export async function loadLedger(userId: string, client: PrismaClient) {
  return cachedCopy(`ledger:${userId}`, client, () => loadLedgerFrom(userId, client));
}

async function loadLedgerFrom(userId: string, client: PrismaClient) {
  const db = scopedFor(userId, client);
  const portfolio = await db.practicePortfolios.findFirst({});
  if (!portfolio) throw new NoPracticePortfolio("Start a practice portfolio first.");
  const rows = await db.practicePositions.findMany({});
  const state: LedgerState = {
    cashCents: portfolio.cashCents,
    positions: Object.fromEntries(
      rows.map((p) => [p.ticker, { quantity: p.quantity, costBasisCents: p.costBasisCents }]),
    ),
  };
  return { portfolio, state };
}

export class PaperBroker implements Broker {
  readonly name = "paper";
  readonly simulated = true;

  async placeOrder(
    userId: string,
    order: Order,
    { client = defaultClient, now = new Date() }: Options = {},
  ): Promise<Fill> {
    const { portfolio, state } = await loadLedger(userId, client);
    const ticker = order.ticker.toUpperCase();
    const asOf = now.toISOString().slice(0, 10);
    const bar = order.priceCents
      ? { closeCents: order.priceCents }
      : await marketData().latest(ticker, asOf);
    if (!bar) throw new LedgerError(`No price for ${ticker}.`);
    const applied = apply(
      state,
      { side: order.side, ticker, amountCents: order.amountCents, priceCents: bar.closeCents },
      LEDGER_UNIVERSE,
    );
    const position = applied.state.positions[ticker];
    const trade = await client.$transaction(async (tx) => {
      const t = await tx.practiceTrade.create({
        data: {
          portfolioId: portfolio.id,
          userId,
          placedAt: now,
          side: order.side,
          ticker,
          quantity: applied.quantity,
          priceCents: bar.closeCents,
          amountCents: order.amountCents,
          gainCents: applied.gainCents,
          reason: order.reason,
          rule: order.rule,
        },
        select: { id: true },
      });
      await tx.practicePortfolio.update({
        where: { id: portfolio.id },
        data: { cashCents: applied.state.cashCents },
      });
      if (position) {
        await tx.practicePosition.upsert({
          where: { portfolioId_ticker: { portfolioId: portfolio.id, ticker } },
          create: { portfolioId: portfolio.id, userId, ticker, ...position },
          update: position,
        });
      } else {
        await tx.practicePosition.deleteMany({ where: { portfolioId: portfolio.id, ticker } });
      }
      return t;
    });
    await logAudit(
      { type: "user", id: userId },
      "practice_trade",
      { type: "practice_trade", id: trade.id },
      { side: order.side, ticker, rule: order.rule, simulated: "true" },
    );
    return {
      tradeId: trade.id,
      ticker,
      side: order.side,
      amountCents: order.amountCents,
      priceCents: bar.closeCents,
      quantity: applied.quantity ?? 0,
      gainCents: applied.gainCents,
      simulated: true,
    };
  }

  async positions(userId: string, { client = defaultClient }: Options = {}) {
    const rows = await scopedFor(userId, client).practicePositions.findMany({
      orderBy: { ticker: "asc" },
    });
    return rows.map((p) => ({
      ticker: p.ticker,
      quantity: p.quantity,
      costBasisCents: p.costBasisCents,
    }));
  }
}

export const practiceBroker = (): Broker => new PaperBroker();
