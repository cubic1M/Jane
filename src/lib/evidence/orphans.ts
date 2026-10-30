import type { PrismaClient } from "@/generated/prisma/client";
import { parseKey } from "@/detection/unusual";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { evidenceRefs, type EvidenceRefs } from "@/lib/finding-accounts";
import { peopleIn, type OnlyPeople } from "@/lib/only-people";

// Derived data never outlives its evidence (card-chat mismatch; design in the shared notes,
// card-chat-mismatch.md). A finding, the decision and actions taken on it, a savings-ledger line
// and an alert are each built from the person's accounts and transactions; once those are gone (a
// bank disconnected, the demo bank left, an upload or a whole start-over removed) the rows built
// from them go too. Without this the chat answered "how much did Jane save me" with the demo
// bank's Comcast, Verizon and Planet Fitness, from actions approved while it was linked.
//
// The rule: a derived row is an orphan when it names accounts or transactions and every one of
// them is gone. One that names part of what is left stays; one that names none (built from what
// the person entered, like an insurance policy) isn't touched here.

type Options = { client?: PrismaClient; now?: Date };

// What is left of the person's data: their accounts, and which of the named transactions exist.
export type Present = { accounts: ReadonlySet<string>; transactions: ReadonlySet<string> };

export async function presentFor(
  userId: string,
  transactionIds: readonly string[],
  client: PrismaClient,
): Promise<Present> {
  const db = scopedFor(userId, client);
  const [accounts, transactions] = await Promise.all([
    db.accounts.findMany({ select: { id: true } }),
    transactionIds.length === 0
      ? []
      : db.transactions.findMany({
          where: { id: { in: [...new Set(transactionIds)] } },
          select: { id: true },
        }),
  ]);
  return {
    accounts: new Set(accounts.map((a) => a.id)),
    transactions: new Set(transactions.map((t) => t.id)),
  };
}

// Whether a row's evidence is all gone. Pure.
export function orphaned(refs: EvidenceRefs, present: Present): boolean {
  const named = refs.accountIds.length + refs.transactionIds.length;
  if (named === 0) return false;
  return (
    refs.accountIds.every((id) => !present.accounts.has(id)) &&
    refs.transactionIds.every((id) => !present.transactions.has(id))
  );
}

export type Removed = { findings: number; outcomes: number; alerts: number };

// Deletes everything derived from evidence that is gone. Findings take their decisions, actions
// and action events with them (foreign keys, ON DELETE CASCADE). Idempotent: safe after every
// sync, upload, removal and every night. Counts only in the logs.
export async function removeOrphans(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<Removed> {
  const db = scopedFor(userId, client);
  const [findings, outcomes, alerts] = await Promise.all([
    db.findings.findMany({ select: { id: true, evidence: true } }),
    db.suggestionOutcomes.findMany({ select: { id: true, evidenceTxIds: true } }),
    db.alerts.findMany({ where: { type: "unusual_activity" }, select: { id: true, key: true } }),
  ]);
  const findingRefs = findings.map((f) => ({ id: f.id, refs: evidenceRefs(f.evidence) }));
  const alertRefs = alerts.flatMap((a) => {
    const parsed = parseKey(a.key);
    return parsed
      ? [{ id: a.id, refs: { accountIds: [], transactionIds: [parsed.transactionId] } }]
      : [];
  });
  const outcomeRefs = outcomes.map((o) => ({
    id: o.id,
    refs: { accountIds: [], transactionIds: o.evidenceTxIds },
  }));
  const present = await presentFor(
    userId,
    [...findingRefs, ...alertRefs, ...outcomeRefs].flatMap((r) => r.refs.transactionIds),
    client,
  );
  const gone = (rows: { id: string; refs: EvidenceRefs }[]) =>
    rows.filter((r) => orphaned(r.refs, present)).map((r) => r.id);
  const outcomeIds = gone(outcomeRefs);
  const removed: Removed = { findings: 0, outcomes: 0, alerts: 0 };
  const findingIds = gone(findingRefs);
  if (findingIds.length > 0) {
    removed.findings = (await db.findings.deleteMany({ where: { id: { in: findingIds } } })).count;
  }
  if (outcomeIds.length > 0) {
    removed.outcomes = (
      await db.suggestionOutcomes.deleteMany({ where: { id: { in: outcomeIds } } })
    ).count;
  }
  const alertIds = gone(alertRefs);
  if (alertIds.length > 0) {
    removed.alerts = (await db.alerts.deleteMany({ where: { id: { in: alertIds } } })).count;
  }
  if (removed.findings + removed.outcomes + removed.alerts > 0) {
    console.info("derived_removed", JSON.stringify({ userId, ...removed }));
    try {
      await logAudit(
        SYSTEM_ACTOR,
        "derived_removed",
        { type: "user", id: userId },
        { user_id: userId, ...removed },
      );
    } catch (error) {
      // The audit row is a record, never a reason to keep stale rows.
      console.error("Auditing removed rows failed", { error: String(error) });
    }
  }
  return removed;
}

// The nightly sweep, for everyone with derived rows: also the one-off cleanup of what was
// orphaned before this existed (it ships with the deploy; nothing connects to production).
export async function removeAllOrphans({
  client = defaultClient,
  userIds,
}: Options & OnlyPeople = {}): Promise<{ users: number; removed: Removed; failed: number }> {
  // A system job across all users: it reads ids only, and removeOrphans scopes each one.
  const users = await client.user.findMany({
    where: {
      OR: [
        { findings: { some: {} } },
        { suggestionOutcomes: { some: {} } },
        { alerts: { some: {} } },
      ],
      ...peopleIn(userIds),
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const removed: Removed = { findings: 0, outcomes: 0, alerts: 0 };
  let failed = 0;
  for (const user of users) {
    try {
      const r = await removeOrphans(user.id, { client });
      removed.findings += r.findings;
      removed.outcomes += r.outcomes;
      removed.alerts += r.alerts;
    } catch (error) {
      failed += 1;
      console.error("Removing orphaned rows failed", { userId: user.id, error: String(error) });
    }
  }
  return { users: users.length, removed, failed };
}
