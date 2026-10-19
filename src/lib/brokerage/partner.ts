import { randomUUID } from "node:crypto";
import { SIMULATED_PARTNER } from "@/config/brokerage";
import { isCryptoTicker } from "@/config/crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import { lastClose, marketDataFor } from "@/lib/market-data/partner";

// The brokerage partner (spec step 133): where Jane sends orders once the person taps,
// and where confirmations come from. An interface, so a real brokerage (with a registered
// adviser) can be connected later; until then the simulated partner below fills orders on
// paper. It never touches real money.

export type OrderRequest = {
  accountId: string;
  ticker: string;
  securityName: string;
  // A deposit (spec step 134) moves money into the account's cash.
  side: "buy" | "sell" | "deposit";
  amountCents: number;
};

export type Confirmation = OrderRequest & {
  orderId: string;
  status: "filled" | "rejected";
  quantity: number;
  priceCents: number;
  confirmation: string | null;
  filledAt: Date | null;
};

export interface BrokeragePartner {
  readonly name: string;
  // True for the simulation: screens must say no real money moves.
  readonly simulated: boolean;
  // The price an order fills at, in cents, or null when the partner doesn't trade it.
  priceOf(
    ticker: string,
    options: { userId: string; client: PrismaClient; now: Date },
  ): Promise<number | null>;
  placeOrders(
    userId: string,
    batch: { batchId: string; reason: string; orders: OrderRequest[] },
    options: { client: PrismaClient; now: Date },
  ): Promise<Confirmation[]>;
}

// Fills every order at the demo price, by dollar amount, and records it. Nothing leaves
// the app.
export const simulatedBrokerage: BrokeragePartner = {
  name: SIMULATED_PARTNER,
  simulated: true,
  // The last close from the market-data partner (spec step 156); cash is always a dollar.
  async priceOf(ticker, { userId, client, now }) {
    if (isCryptoTicker(ticker)) return null;
    if (ticker.toUpperCase() === "CASH") return 100;
    const market = await marketDataFor(userId, client);
    return market?.priceCents(ticker, lastClose(now)) ?? null;
  },
  async placeOrders(userId, { batchId, reason, orders }, { client, now }) {
    refuseCrypto(orders);
    const db = scopedFor(userId, client);
    const out: Confirmation[] = [];
    for (const order of orders) {
      const priceCents = await this.priceOf(order.ticker, { userId, client, now });
      const filled = priceCents !== null && order.amountCents > 0;
      const quantity = filled ? Number((order.amountCents / priceCents).toFixed(6)) : 0;
      const confirmation = filled ? `SIM-${randomUUID().slice(0, 8).toUpperCase()}` : null;
      const row = await db.brokerageOrders.create({
        data: {
          userId,
          accountId: order.accountId,
          batchId,
          reason,
          partner: SIMULATED_PARTNER,
          ticker: order.ticker,
          securityName: order.securityName,
          side: order.side,
          amountCents: order.amountCents,
          quantity,
          priceCents: priceCents ?? 0,
          status: filled ? "filled" : "rejected",
          confirmation,
          placedAt: now,
          filledAt: filled ? now : null,
        },
        select: { id: true },
      });
      out.push({
        ...order,
        orderId: row.id,
        status: filled ? "filled" : "rejected",
        quantity,
        priceCents: priceCents ?? 0,
        confirmation,
        filledAt: filled ? now : null,
      });
    }
    return out;
  },
};

export class NoCryptoOrders extends Error {
  constructor() {
    super("Jane never trades crypto.");
  }
}

// Spec step 161: there is no order path for crypto. Any batch with a crypto order is
// refused whole, before anything is recorded, whichever partner is in use.
export function refuseCrypto(orders: OrderRequest[]) {
  if (orders.some((o) => isCryptoTicker(o.ticker))) throw new NoCryptoOrders();
}

// The partner in use. Swap in a real brokerage here once one is connected.
export const brokeragePartner = (): BrokeragePartner => simulatedBrokerage;
