import { cache } from "react";
import { CONCIERGE_ACTIONS } from "@/config/concierge";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { isDemoItemId } from "@/lib/plaid/demo";
import { isTrialUser } from "@/lib/trial-ids";
import { cachedRead } from "@/lib/read-cache";

// Read-only mode: whether Jane (its agent, and the queue behind it) acts for this person, or
// shows them how to do it themselves. Like demo advice (src/lib/advice-mode.ts), the demo
// side is only a person whose every account comes from the demo bank, or a trial person: a
// real bank or a CSV import next to the demo bank makes them a real account.

export async function conciergeMode(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<boolean> {
  return client === defaultClient
    ? conciergeOnce(userId)
    : cachedRead(`conciergeMode:${userId}`, client, () => conciergeFrom(userId, client));
}

// Worked out once per server render (React's cache): a page's parts may each ask.
const conciergeOnce = cache((userId: string) => conciergeFrom(userId, defaultClient));

async function conciergeFrom(userId: string, client: PrismaClient): Promise<boolean> {
  if (isTrialUser(userId)) return CONCIERGE_ACTIONS.demo;
  const db = scopedFor(userId, client);
  const [items, csvAccounts] = await Promise.all([
    db.plaidItems.findMany({ select: { plaidItemId: true } }),
    db.accounts.count({ where: { source: "csv" } }),
  ]);
  const demoOnly =
    items.length > 0 && csvAccounts === 0 && items.every((i) => isDemoItemId(i.plaidItemId));
  return demoOnly ? CONCIERGE_ACTIONS.demo : CONCIERGE_ACTIONS.realAccounts;
}
