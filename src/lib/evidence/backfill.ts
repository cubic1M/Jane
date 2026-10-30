import type { PrismaClient } from "@/generated/prisma/client";
import { DEMO_INSTITUTION } from "@/data-sources/demo/demo-bank";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import type { OnlyPeople } from "@/lib/only-people";
import { forgetSince, removeOrphans } from "./orphans";

// The one-off cleanup for demo banks disconnected before forgetSince existed (card-chat
// mismatch): the founder's account kept the demo bank's Comcast, Verizon and Planet Fitness
// estimates. The audit log has when each demo bank was linked and removed; for each removed one
// not done yet, what was worked out since it was linked is forgotten, the person's own numbers
// are worked out again, and it is marked done, so it runs once per demo bank. Nightly, through
// the deploy; nothing connects to production. Counts only in the logs.

const DONE = "demo-forgotten:";

export async function forgetRemovedDemoBanks({
  client = defaultClient,
  now = new Date(),
  userIds,
  refresh,
}: {
  client?: PrismaClient;
  now?: Date;
  refresh?: (userId: string) => Promise<void>;
} & OnlyPeople = {}): Promise<{
  forgotten: number;
  failed: number;
}> {
  // A system job: the audit log isn't anyone's table; each person's rows are scoped below.
  const removed = await client.auditLog.findMany({
    where: {
      event: "item_removed",
      targetType: "plaid_item",
      metadata: { path: ["institution"], equals: DEMO_INSTITUTION },
    },
    select: { targetId: true, metadata: true },
  });
  let forgotten = 0;
  let failed = 0;
  for (const r of removed) {
    const userId = (r.metadata as { user_id?: unknown }).user_id;
    if (!r.targetId || typeof userId !== "string") continue;
    if (userIds && !userIds.includes(userId)) continue;
    if (!(await client.user.findFirst({ where: { id: userId }, select: { id: true } }))) continue;
    const db = scopedFor(userId, client);
    const key = `${DONE}${r.targetId}`;
    if (await db.janePreferences.findFirst({ where: { kind: "system", key } })) continue;
    const linked = await client.auditLog.findFirst({
      where: { event: "item_linked", targetType: "plaid_item", targetId: r.targetId },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    try {
      if (linked) {
        await removeOrphans(userId, { client });
        const count = await forgetSince(db, linked.createdAt, "bank");
        if (refresh) await refresh(userId);
        console.info("demo_forgotten", JSON.stringify({ userId, rows: count }));
        forgotten += 1;
      }
      await db.janePreferences.create({
        data: {
          userId,
          kind: "system",
          key,
          value: { at: now.toISOString() },
          label: "Demo bank cleaned up",
        },
      });
    } catch (error) {
      failed += 1;
      console.error("Forgetting a removed demo bank failed", { userId, error: String(error) });
    }
  }
  return { forgotten, failed };
}
