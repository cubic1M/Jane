import { WORKED_GRACE_DAYS } from "@/config/worked";
import type { FindingType, PrismaClient } from "@/generated/prisma/client";
import { loadDetectionInput } from "@/detection/engine";
import type { DetectionInput } from "@/detection/types";
import { addDays } from "@/detection/units";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { provenSavings } from "@/lib/savings-proof";
import { isoDay as isoDate } from "@/lib/dates";

// What worked (spec step 207): every finished action is checked against the person's later
// transactions (src/lib/savings-proof.ts does the matching). One whose saving hasn't shown
// after WORKED_GRACE_DAYS is marked, and stops counting as saved; if it shows up later the
// mark comes off. And per kind of finding: what the person says yes and no to, and how many
// of the actions that followed really worked. Ranking (step 143) reads it.

type Options = { client?: PrismaClient; now?: Date; input?: DetectionInput };

// Marks and unmarks. Returns how many were newly marked.
export async function checkResults(
  userId: string,
  { client = defaultClient, now = new Date(), input: given }: Options = {},
): Promise<{ marked: number; restored: number }> {
  const input = given ?? (await loadDetectionInput(userId, { client, now }));
  const db = scopedFor(userId, client);
  const proven = await provenSavings(userId, { client, now, input });
  const cutoff = new Date(`${addDays(isoDate(now), -WORKED_GRACE_DAYS)}T23:59:59Z`);

  const restored = await db.actions.updateMany({
    where: { id: { in: proven.confirmed.map((r) => r.actionId) }, savingMissedAt: { not: null } },
    data: { savingMissedAt: null },
  });
  const late = await db.actions.findMany({
    where: {
      id: { in: proven.estimated.map((e) => e.actionId) },
      status: "done",
      completedAt: { lte: cutoff },
      savingMissedAt: null,
    },
    select: { id: true },
  });
  if (late.length > 0) {
    await db.actions.updateMany({
      where: { id: { in: late.map((a) => a.id) } },
      data: { savingMissedAt: now },
    });
    await logAudit(
      { type: "user", id: userId },
      "saving_marked_not_shown",
      { type: "user", id: userId },
      { count: late.length },
    );
  }
  return { marked: late.length, restored: restored.count };
}

export type KindResult = {
  type: FindingType;
  yes: number;
  no: number;
  done: number;
  worked: number;
  notShown: number;
  workedCents: number;
};

export async function resultsByKind(
  userId: string,
  { client = defaultClient, now = new Date(), input }: Options = {},
): Promise<KindResult[]> {
  const db = scopedFor(userId, client);
  const [decisions, actions, proven] = await Promise.all([
    db.decisions.findMany({
      where: { choice: { in: ["yes", "no"] }, undoneAt: null },
      select: { choice: true, finding: { select: { type: true } } },
    }),
    db.actions.findMany({
      where: { status: "done" },
      select: {
        id: true,
        savingMissedAt: true,
        decision: { select: { finding: { select: { type: true } } } },
      },
    }),
    provenSavings(userId, { client, now, input }),
  ]);
  const worked = new Map(proven.confirmed.map((r) => [r.actionId, r.cents]));
  const kinds = new Map<FindingType, KindResult>();
  const row = (type: FindingType) => {
    const have = kinds.get(type);
    if (have) return have;
    const fresh: KindResult = {
      type,
      yes: 0,
      no: 0,
      done: 0,
      worked: 0,
      notShown: 0,
      workedCents: 0,
    };
    kinds.set(type, fresh);
    return fresh;
  };
  for (const d of decisions) {
    const r = row(d.finding.type);
    if (d.choice === "yes") r.yes += 1;
    else r.no += 1;
  }
  for (const a of actions) {
    const r = row(a.decision.finding.type);
    r.done += 1;
    const cents = worked.get(a.id);
    if (cents !== undefined) {
      r.worked += 1;
      r.workedCents += cents;
    } else if (a.savingMissedAt) r.notShown += 1;
  }
  return [...kinds.values()].sort((a, b) => a.type.localeCompare(b.type));
}
