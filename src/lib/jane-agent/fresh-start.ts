import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import type { ScopedDb } from "@/lib/db-scoped";
import { systemDb } from "@/lib/system-db";

// A fresh start (night debugger, round 217): someone tries the demo bank, removes it in Settings
// and links their own bank the same day. Jane's messages about the demo bank stay as the chat's
// history, but they were about data that is gone, so they no longer use up the day's messages
// (CHAT_DAILY_LIMIT) or stop the new bank's suggestions as already said (src/lib/jane-agent/
// brain.ts). Otherwise the first real sync brought 2 cards while 17 suggestions waited.
//
// When the last bank or uploaded account goes, the time of Jane's newest message is kept in one
// jane_preferences row (kind "system", which Settings and Claude never see); the brain's runs
// count only what came after it. It is a message's own time, not the clock's, so it compares
// with messages whatever clock wrote them. And the next bank or file is scanned as a first one:
// the scanning screen, and no "new subscription" alerts for what is only new to Jane.

const KEY = "fresh_start";

type Db = Pick<ScopedDb, "userId" | "plaidItems" | "accounts" | "janeMessages" | "janePreferences">;

// After a removal: marks a fresh start if the person has no bank or account left.
export async function markFreshStartIfEmpty(
  db: Db,
  client: PrismaClient = defaultClient,
): Promise<void> {
  const [banks, accounts] = await Promise.all([db.plaidItems.count(), db.accounts.count()]);
  if (banks + accounts > 0) return;
  await systemDb("A person's own row: jane_rls only reads users", client).user.updateMany({
    where: { id: db.userId },
    data: { firstDetectionAt: null, firstScanDoneAt: null },
  });
  const newest = await db.janeMessages.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!newest) return;
  const value = { after: newest.createdAt.toISOString() };
  await db.janePreferences.upsert({
    where: { userId_kind_key: { userId: db.userId, kind: "system", key: KEY } },
    create: { userId: db.userId, kind: "system", key: KEY, value, label: "Fresh start" },
    update: { value },
  });
}

// The newest message from before the last fresh start, or null if there was none: Jane's runs
// count only messages after it.
export async function freshStartAfter(db: Pick<Db, "userId" | "janePreferences">) {
  const row = await db.janePreferences.findUnique({
    where: { userId_kind_key: { userId: db.userId, kind: "system", key: KEY } },
    select: { value: true },
  });
  const after = (row?.value as { after?: unknown } | null)?.after;
  return typeof after === "string" ? new Date(after) : null;
}
