import { accountKindOf } from "@/data-sources/types";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import type { ScopedDb } from "@/lib/db-scoped";
import { enqueueJob } from "@/lib/jobs";

// An uploaded account's balance today, asked for when its file doesn't carry one (cards, Wells
// Fargo: no balance column). Until it's given, net worth says what it isn't counting rather than
// leaving the debt out silently (CSV bench: card debt missing for most upload-only people).
// Skipping stays allowed.

export { balanceQuestion, type BalanceAsk } from "./balance-question";
import type { BalanceAsk } from "./balance-question";

// Uploaded accounts still without a balance.
export async function balancesToAsk(db: Pick<ScopedDb, "accounts">): Promise<BalanceAsk[]> {
  const accounts = await db.accounts.findMany({
    where: { source: "csv", currentBalanceCents: null },
    select: { id: true, name: true, type: true, subtype: true },
    orderBy: { createdAt: "asc" },
  });
  return accounts.flatMap((a) => {
    const kind = accountKindOf(a.type, a.subtype);
    return kind ? [{ accountId: a.id, name: a.name, kind }] : [];
  });
}

// One uploaded account's balance, from the person. Then the numbers are worked out again in the
// background (src/lib/import/background.ts): balances over time, net worth, every area. Null
// when it isn't the person's uploaded account.
export async function setUploadedBalance(
  db: Pick<ScopedDb, "userId" | "accounts" | "importRuns">,
  accountId: string,
  cents: number,
): Promise<{ jobId: string } | null> {
  const { count } = await db.accounts.updateMany({
    where: { id: accountId, source: "csv" },
    data: { currentBalanceCents: cents },
  });
  if (count === 0) return null;
  await Promise.all([
    logAudit({ type: "user", id: db.userId }, "uploaded_balance_set", {
      type: "account",
      id: accountId,
    }),
    track(db.userId, "uploaded_balance_set"),
  ]);
  const run = await db.importRuns.create({
    data: { userId: db.userId, kind: "update", rows: 0 },
    select: { id: true },
  });
  return { jobId: await enqueueJob("import_finish", { userId: db.userId, importRunId: run.id }) };
}
