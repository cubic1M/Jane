import { formatCents } from "@/lib/money";
import { plural } from "@/lib/plural";
import { throughPermission, type Authority } from "@/lib/permission/check";
import type { PrismaClient } from "@/generated/prisma/client";
import type { BrokeragePartner, Confirmation } from "./partner";

// Placing orders always goes through the permission check (src/lib/permission/check.ts). A tap is
// the person's yes; what runs on its own passes the standing limit it asked mayAct about.

export async function placeThrough(
  partner: BrokeragePartner,
  userId: string,
  batch: Parameters<BrokeragePartner["placeOrders"]>[1],
  options: { client: PrismaClient; now: Date },
  authority: Authority = { kind: "yes" },
): Promise<Confirmation[]> {
  // What it commits: a swap's sale and purchase are one amount, so sales count only on their own.
  const buys = batch.orders.filter((o) => o.side !== "sell");
  const cents = (buys.length > 0 ? buys : batch.orders).reduce((sum, o) => sum + o.amountCents, 0);
  const tickers = [...new Set(batch.orders.map((o) => o.ticker))].join(", ");
  return throughPermission(
    userId,
    {
      specialist: "brokerage",
      what: `Placed ${plural(batch.orders.length, "order")} for ${formatCents(cents)}: ${tickers}`,
      sector: "investing",
      cents,
      authority,
      undo: { kind: "none", why: "A simulated fill: nothing real to take back." },
    },
    options,
    () => partner.placeOrders(userId, batch, options),
  );
}
