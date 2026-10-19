import { randomUUID } from "node:crypto";
import { SIMULATED_PARTNER } from "@/config/brokerage";
import { DEMO_PRICES } from "@/data-sources/demo/demo-holdings";
import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";

// The brokerage partner (spec step 133): where Jane sends orders once the person taps,
// and where confirmations come from. An interface, so a real brokerage (with a registered
// adviser) can be connected later; until then the simulated partner below fills orders on
// paper. It never touches real money.

export type OrderRequest = {
  accountId: string;
  ticker: string;
  securityName: string;
  side: "buy" | "sell";
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
  // Today's price for a ticker, in cents, or null when the partner doesn't trade it.
  priceOf(ticker: string): number | null;
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
  priceOf(ticker) {
    const price = DEMO_PRICES[ticker.toUpperCase()];
    return price === undefined ? null : Math.round(price * 100);
  },
  async placeOrders(userId, { batchId, reason, orders }, { client, now }) {
    const db = scopedFor(userId, client);
    const out: Confirmation[] = [];
    for (const order of orders) {
      const priceCents = this.priceOf(order.ticker);
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

// The partner in use. Swap in a real brokerage here once one is connected.
export const brokeragePartner = (): BrokeragePartner => simulatedBrokerage;
