import type { PrismaClient } from "@/generated/prisma/client";
import { parseKey } from "@/detection/unusual";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { evidenceRefs, type EvidenceRefs } from "@/lib/finding-accounts";
import { CLEARED_WITHOUT_DATA, DEMO_SEEDED } from "@/config/lineage";
import { PERSON_ASSETS } from "@/data-sources/demo/demo-people";
import { merchantOf } from "@/detection/streams";
import { DEMO_ASSETS } from "@/lib/plaid/demo-assets";
import { peopleIn, type OnlyPeople } from "@/lib/only-people";
import { hasDemoBank } from "@/lib/plaid/demo";
import { SAMPLE_WIN_KEY } from "@/lib/sample-wins";

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

export type Removed = { findings: number; outcomes: number; alerts: number; cleared?: number };

// Clears what CLEARED_WITHOUT_DATA lists, facts read from statements, policies found from
// payments, and puts away Jane's open cards. Scoped by the person's id on every table.
async function clearWithoutData(userId: string, client: PrismaClient): Promise<number> {
  const scoped = scopedFor(userId, client) as unknown as Record<
    string,
    { deleteMany: (args: object) => Promise<{ count: number }> }
  >;
  let cleared = 0;
  for (const table of Object.values(CLEARED_WITHOUT_DATA)) {
    const [key, where] = typeof table === "string" ? [table, {}] : table;
    cleared += (await scoped[key].deleteMany({ where })).count;
  }
  const db = scopedFor(userId, client);
  cleared += (await db.userFacts.deleteMany({ where: { source: { in: ["upload", "detector"] } } }))
    .count;
  cleared += (await db.insurancePolicies.deleteMany({ where: { status: "found" } })).count;
  cleared += (
    await db.janeMessages.updateMany({
      where: { status: "open", kind: { in: ["heads_up", "decision", "brief", "done"] } },
      data: { status: "answered", answeredAt: new Date(), actions: [] },
    })
  ).count;
  return cleared;
}

// Deletes everything derived from evidence that is gone. Findings take their decisions, actions
// and action events with them (foreign keys, ON DELETE CASCADE). Idempotent: safe after every
// sync, upload, removal and every night. Counts only in the logs.
export async function removeOrphans(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<Removed> {
  const db = scopedFor(userId, client);
  const [findings, outcomes, alerts] = await Promise.all([
    db.findings.findMany({ select: { id: true, key: true, evidence: true } }),
    db.suggestionOutcomes.findMany({ select: { id: true, evidenceTxIds: true } }),
    db.alerts.findMany({ where: { type: "unusual_activity" }, select: { id: true, key: true } }),
  ]);
  const findingRefs = findings.map((f) => ({ id: f.id, refs: evidenceRefs(f.evidence) }));
  // A sample person's past wins (src/lib/sample-wins.ts) are seeded when the demo bank is
  // linked, before its transactions arrive, so they name no rows: they stand on the demo bank
  // itself, and go once it is gone.
  const wins = findings.filter((f) => f.key.startsWith(SAMPLE_WIN_KEY)).map((f) => f.id);
  const winsGone = wins.length > 0 && !(await hasDemoBank(userId, { client })) ? wins : [];
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
  const findingIds = [...gone(findingRefs), ...winsGone];
  removed.cleared = await removeDemoLeftovers(userId, client);
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
  // Nothing of the person's data is left: everything else worked out from it goes too.
  const any = findings.length + outcomes.length + alerts.length > 0;
  if (present.accounts.size === 0 && (any || (await hasDerived(userId, client)))) {
    removed.cleared = (removed.cleared ?? 0) + (await clearWithoutData(userId, client));
  }
  if (removed.findings + removed.outcomes + removed.alerts + (removed.cleared ?? 0) > 0) {
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

// What the demo bank seeded, once the person has no demo bank (night debugger, 10-30: after it
// was disconnected the dock still offered to add "Demo car" to the demo's GEICO policy, and net
// worth still counted the demo home). Then: insurance found from payments that no transaction
// left comes from, and cover changes prepared for an event that is no longer there. How many.
async function removeDemoLeftovers(userId: string, client: PrismaClient): Promise<number> {
  const db = scopedFor(userId, client);
  const scoped = db as unknown as Record<
    string,
    { deleteMany: (args: object) => Promise<{ count: number }> }
  >;
  let removed = 0;
  if (!(await hasDemoBank(userId, { client }))) {
    for (const table of Object.values(DEMO_SEEDED)) {
      removed += (await scoped[table].deleteMany({ where: { source: "demo" } })).count;
    }
    const seeded = [...DEMO_ASSETS, ...Object.values(PERSON_ASSETS).flat()];
    const assets = await db.ownedAssets.findMany({
      select: { id: true, kind: true, name: true, valueCents: true },
    });
    const demoAssets = assets.filter((a) =>
      seeded.some((d) => d.kind === a.kind && d.name === a.name && d.valueCents === a.valueCents),
    );
    if (demoAssets.length > 0) {
      removed += (
        await db.ownedAssets.deleteMany({ where: { id: { in: demoAssets.map((a) => a.id) } } })
      ).count;
    }
  }
  // Insurance found from payments: its insurer's payments are still there, or it goes.
  const found = await db.insurancePolicies.findMany({
    where: { status: "found", merchantKey: { not: null } },
    select: { id: true, merchantKey: true },
  });
  if (found.length > 0) {
    // Loaded here: detection runs this, so a static import would go round in a circle.
    const { loadTransactionsBetween } = await import("@/detection/engine");
    const rows = await loadTransactionsBetween(userId, {
      client,
      from: "2000-01-01",
      to: new Date().toISOString().slice(0, 10),
    });
    const paid = new Set(rows.flatMap((t) => merchantOf(t)?.key ?? []));
    const stale = found.filter((p) => !paid.has(p.merchantKey!)).map((p) => p.id);
    if (stale.length > 0) {
      removed += (await db.insurancePolicies.deleteMany({ where: { id: { in: stale } } })).count;
    }
  }
  // Cover changes waiting on the person, for an event whose row is gone: a car they own, a car
  // loan's account, a life event (src/lib/insurance/cover-changes.ts coverEvents keys them so).
  const prepared = await db.coverChanges.findMany({
    where: { status: "prepared" },
    select: { id: true, eventKey: true },
  });
  if (prepared.length > 0) {
    const keys = [...new Set(prepared.map((c) => c.eventKey))];
    const [assets, accounts, events] = await Promise.all([
      db.ownedAssets.findMany({ where: { id: { in: keys } }, select: { id: true } }),
      db.accounts.findMany({ where: { id: { in: keys } }, select: { id: true } }),
      db.lifeEvents.findMany({ where: { id: { in: keys } }, select: { id: true } }),
    ]);
    const there = new Set([...assets, ...accounts, ...events].map((r) => r.id));
    // "told:<date>" (what the person said) names no row: it stays.
    const stale = prepared
      .filter((c) => !c.eventKey.startsWith("told:") && !there.has(c.eventKey))
      .map((c) => c.id);
    if (stale.length > 0) {
      removed += (await db.coverChanges.deleteMany({ where: { id: { in: stale } } })).count;
    }
  }
  return removed;
}

// Whether anything worked out from data is still there, for someone with no data left.
async function hasDerived(userId: string, client: PrismaClient): Promise<boolean> {
  const db = scopedFor(userId, client);
  const [facts, policies, proposals, open] = await Promise.all([
    db.userFacts.count({ where: { source: { in: ["upload", "detector"] } } }),
    db.insurancePolicies.count({ where: { status: "found" } }),
    db.planProposals.count(),
    db.suggestions.count(),
  ]);
  return facts + policies + proposals + open > 0;
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
        { suggestions: { some: {} } },
        { planProposals: { some: {} } },
        { userFacts: { some: { source: { in: ["upload", "detector"] } } } },
        { insurancePolicies: { some: { status: "found" } } },
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
