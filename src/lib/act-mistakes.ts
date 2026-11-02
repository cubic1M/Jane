import { SECTORS, type Sector } from "@/config/autopilot-sectors";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { revokeArea } from "@/lib/standing-permission";

// When Jane gets something wrong (Stage 2, docs/mistakes.md): the person says so on /jane. It goes on
// the record, the rest of that action stops, and that area goes back to asking, so nothing else
// happens there while it's looked at. A person then closes it on /admin/mistakes. The rate is what
// the gate to Stage 3 tracks.

type Options = { client?: PrismaClient; now?: Date };

export const MISTAKE_NOTE_MAX = 1_000;

export class MistakeError extends Error {}

export async function reportMistake(
  userId: string,
  actId: string,
  note: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const act = await db.janeActs.findFirst({
    where: { id: actId, status: "done" },
    select: { id: true, sector: true, simulated: true, actionId: true },
  });
  if (!act) throw new MistakeError("That isn't on your record.");
  await db.actMistakes.createMany({
    data: [
      {
        userId,
        actId: act.id,
        note: note.trim().slice(0, MISTAKE_NOTE_MAX),
        simulated: act.simulated,
        createdAt: now,
      },
    ],
    skipDuplicates: true,
  });
  // What's still going on this action stops; a person looks at it first.
  if (act.actionId) {
    await db.actions.updateMany({
      where: { id: act.actionId, agentState: { in: ["working", "waiting_reply", "confirming"] } },
      data: {
        agentState: "handed_off",
        agentNextAt: null,
        handoffReason: "You told us something went wrong. Jane has stopped working on this.",
      },
    });
  }
  // The area goes back to asking.
  if ((SECTORS as readonly string[]).includes(act.sector)) {
    await revokeArea(userId, act.sector as Sector, { client, now });
  }
  await logAudit(
    { type: "user", id: userId },
    "jane_act_mistake_reported",
    { type: "jane_act", id: act.id },
    { sector: act.sector, simulated: act.simulated },
  );
  await track(userId, "jane_act_mistake_reported", { sector: act.sector });
}

// A person closes it, saying what was done.
export async function closeMistake(
  mistakeId: string,
  resolution: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const text = resolution.trim();
  if (!text) throw new MistakeError("Say what was done about it.");
  // A team tool across people, by the mistake's own id.
  const { count } = await client.actMistake.updateMany({
    where: { id: mistakeId, status: "open" },
    data: { status: "handled", resolution: text.slice(0, MISTAKE_NOTE_MAX), handledAt: now },
  });
  if (count === 0) throw new MistakeError("That one's already closed.");
  await logAudit(SYSTEM_ACTOR, "jane_act_mistake_closed", { type: "act_mistake", id: mistakeId });
}

export type MistakeStats = { acts: number; mistakes: number; open: number; rate: number | null };

// The mistake rate, real acts only, never a trial person's. `simulated` shows the rehearsal's.
export async function mistakeStats({
  client = defaultClient,
  simulated = false,
}: { client?: PrismaClient; simulated?: boolean } = {}): Promise<MistakeStats> {
  const notTrial = { NOT: { userId: { startsWith: TRIAL_ID_PREFIX } } };
  const [acts, mistakes, open] = await Promise.all([
    client.janeAct.count({ where: { status: "done", simulated, ...notTrial } }),
    client.actMistake.count({ where: { simulated, ...notTrial } }),
    client.actMistake.count({ where: { simulated, status: "open", ...notTrial } }),
  ]);
  return { acts, mistakes, open, rate: acts === 0 ? null : mistakes / acts };
}
