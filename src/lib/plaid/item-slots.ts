import {
  LINKING_FULL_CODE,
  LINKING_FULL_WORDS,
  LINKING_TRIAL_WORDS,
  LINKING_UPLOAD_WORDS,
  plaidItemLimit,
  plaidItemsPerPerson,
  plaidItemWarnAt,
} from "@/config/plaid-items";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { log } from "@/lib/log";
import { isTrialUser } from "@/lib/trial-ids";
import { plaidEnvironment } from "./client";
import { COUNTER_ID, itemSlotUse } from "./item-count";

// Plaid's Trial plan allows a fixed number of Production Items, ever (docs/setup/plaid-trial.md).
// A lasting counter says how many are used, since plaid_items rows go when a bank is removed, and
// a claim per person stops one person spending several. Only Production counts: Sandbox never does
// and the demo bank never reaches here (src/lib/plaid/demo.ts makes its own rows). Update mode
// reuses the same Item, so it never takes a slot.
//
// audit_log wouldn't do: its item_linked entries are deleted after RETENTION_PERIODS.accessLog,
// carry an IP address and browser, and can't refuse the 11th of two at once.

type Options = { client?: PrismaClient };

export type ClosedReason = "full" | "person" | "trial";
export type LinkAvailability = { open: true } | { open: false; reason: ClosedReason };
export type ItemSlot = { userId: string; ordinal: number };

export class LinkingClosedError extends Error {
  constructor(readonly reason: ClosedReason) {
    super("No new bank can be linked.");
  }
}

// The answer a route gives. Never a raw error, and the link button acts on the code.
export function linkClosedAnswer(reason: ClosedReason) {
  return reason === "trial"
    ? { error: LINKING_TRIAL_WORDS }
    : { error: `${LINKING_FULL_WORDS} ${LINKING_UPLOAD_WORDS}`, code: LINKING_FULL_CODE };
}

// Whether a new bank could be linked right now. A guard before opening Link; only
// reserveItemSlot decides. Trial people are sample data: a real Item for them would spend a slot
// on someone deleted within a day, so in Production they keep to the demo bank.
export async function linkAvailability(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<LinkAvailability> {
  if (plaidEnvironment() !== "production") return { open: true };
  if (isTrialUser(userId)) return { open: false, reason: "trial" };
  const [claims, use] = await Promise.all([
    scopedFor(userId, client).plaidItemClaims.count(),
    itemSlotUse({ client }),
  ]);
  if (claims >= plaidItemsPerPerson()) return { open: false, reason: "person" };
  if (use.used >= use.limit) return { open: false, reason: "full" };
  return { open: true };
}

// Takes a slot, or throws LinkingClosedError. Null outside Production, where nothing counts. Each
// step is one atomic statement, so two people at once can't pass either limit. A crash in between
// leaves the person's claim too high, never the count too low: Plaid's limit is the hard one.
export async function reserveItemSlot(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<ItemSlot | null> {
  if (plaidEnvironment() !== "production") return null;
  if (isTrialUser(userId)) throw new LinkingClosedError("trial");

  const db = scopedFor(userId, client);
  const claims = await db.plaidItemClaims.findMany({ select: { ordinal: true } });
  const taken = new Set(claims.map((c) => c.ordinal));
  let ordinal = 1;
  while (taken.has(ordinal)) ordinal++;
  if (ordinal > plaidItemsPerPerson()) throw new LinkingClosedError("person");
  // Two tabs both after the same one: the key lets one in.
  const { count } = await db.plaidItemClaims.createMany({
    data: [{ userId, ordinal }],
    skipDuplicates: true,
  });
  if (count === 0) throw new LinkingClosedError("person");

  const limit = plaidItemLimit();
  await client.plaidItemCounter.createMany({ data: [{ id: COUNTER_ID }], skipDuplicates: true });
  const won = await client.plaidItemCounter.updateManyAndReturn({
    where: { id: COUNTER_ID, used: { lt: limit } },
    data: { used: { increment: 1 } },
    select: { used: true },
  });
  if (won.length === 0) {
    await db.plaidItemClaims.deleteMany({ where: { ordinal } });
    throw new LinkingClosedError("full");
  }
  const { used } = won[0];
  if (used >= plaidItemWarnAt(limit)) {
    log.warn("Plaid Production Items are nearly used", { used, limit });
  }
  return { userId, ordinal };
}

// Gives a slot back only when no access token was made. Removing an Item or an account never
// comes here.
export async function releaseItemSlot(
  { userId, ordinal }: ItemSlot,
  { client = defaultClient }: Options = {},
): Promise<void> {
  await client.plaidItemCounter.updateMany({
    where: { id: COUNTER_ID, used: { gt: 0 } },
    data: { used: { decrement: 1 } },
  });
  await scopedFor(userId, client).plaidItemClaims.deleteMany({ where: { ordinal } });
}
