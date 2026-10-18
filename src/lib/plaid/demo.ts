import type { PlaidApi } from "plaid";
import {
  DEMO_INSTITUTION,
  demoAccounts,
  demoLiabilities,
  demoSwitchTransactions,
  demoTransactions,
  type DemoSeed,
  type DemoSwitch,
} from "@/data-sources/demo/demo-bank";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { encrypt } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { plaidEnabled } from "./client";

// The demo bank (spec step 75): a stand-in for Plaid's API while there are no keys. A demo
// item is an ordinary plaid_items row whose ids start with "demo-" and whose (encrypted)
// access token names the demo seed and the day it was linked, so the normal sync, removal
// and daily refresh all work on it. It never talks to Plaid.

const DEMO_ITEM_PREFIX = "demo-";
const DEMO_TOKEN_PREFIX = "demo:";

export const isDemoItemId = (plaidItemId: string) => plaidItemId.startsWith(DEMO_ITEM_PREFIX);
export const isDemoToken = (accessToken: string) => accessToken.startsWith(DEMO_TOKEN_PREFIX);

// Offered when Plaid isn't set up and this isn't production; DEMO_BANK=1 turns it on
// anywhere (e.g. a deployed preview before the Plaid keys arrive).
export function demoBankEnabled(): boolean {
  if (process.env.DEMO_BANK === "1") return true;
  return !plaidEnabled() && process.env.NODE_ENV !== "production";
}

function seedOf(accessToken: string): DemoSeed {
  const [, seed, anchor] = accessToken.split(":");
  if (!seed || !/^\d{4}-\d{2}-\d{2}$/.test(anchor ?? "")) throw new Error("Not a demo token");
  return { seed, anchor };
}

const today = (now: Date) => now.toISOString().slice(0, 10);
const yesterday = (now: Date) => new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);

// Just the calls the app makes, answered with the demo bank's data. The cursor is the last
// day already sent, so each sync adds only the days since.
export function demoPlaidApi(
  accessToken: string,
  now: Date = new Date(),
  // Switches the person made, so their new bills show up (spec step 77).
  switches: DemoSwitch[] = [],
): PlaidApi {
  const demo = seedOf(accessToken);
  const through = yesterday(now);
  const api = {
    transactionsSync: async ({ cursor }: { cursor?: string }) => {
      const after = cursor && /^\d{4}-\d{2}-\d{2}$/.test(cursor) ? cursor : null;
      return {
        data: {
          accounts: demoAccounts(demo),
          added:
            after !== null && after >= through
              ? []
              : [
                  ...demoTransactions(demo, after, through),
                  ...demoSwitchTransactions(demo, switches, after, through),
                ],
          modified: [],
          removed: [],
          next_cursor: after !== null && after > through ? after : through,
          has_more: false,
        },
      };
    },
    // No recurring streams: Jane's own detection finds the recurring charges.
    transactionsRecurringGet: async () => ({ data: { outflow_streams: [], inflow_streams: [] } }),
    liabilitiesGet: async () => ({
      data: { accounts: demoAccounts(demo), liabilities: demoLiabilities(demo, today(now)) },
    }),
    itemRemove: async () => ({ data: {} }),
  };
  return api as unknown as PlaidApi;
}

export class DemoBankError extends Error {}

// Links a demo bank for the person, or returns the one they already have. The caller runs
// the first sync.
export async function linkDemoBank(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<{ itemId: string; created: boolean }> {
  if (!demoBankEnabled()) throw new DemoBankError("The demo bank isn't available here.");
  const db = scopedFor(userId, client);
  const existing = await db.plaidItems.findFirst({
    where: { plaidItemId: { startsWith: DEMO_ITEM_PREFIX } },
    select: { id: true },
  });
  if (existing) return { itemId: existing.id, created: false };
  const seed = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  const item = await db.plaidItems.create({
    data: {
      userId,
      plaidItemId: `${DEMO_ITEM_PREFIX}${seed}`,
      accessTokenEncrypted: encrypt(`${DEMO_TOKEN_PREFIX}${seed}:${today(now)}`),
      institutionName: DEMO_INSTITUTION,
      liabilities: true,
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "item_linked",
    { type: "plaid_item", id: item.id },
    { institution: DEMO_INSTITUTION, demo: true },
  );
  await track(userId, "link_succeeded", { institution: DEMO_INSTITUTION, demo: true });
  return { itemId: item.id, created: true };
}

// Whether the person is looking at demo data, for the banner.
export async function hasDemoBank(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<boolean> {
  const count = await scopedFor(userId, client).plaidItems.count({
    where: { plaidItemId: { startsWith: DEMO_ITEM_PREFIX } },
  });
  return count > 0;
}
