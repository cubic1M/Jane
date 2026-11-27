import { CONNECTOR_STUCK_MINUTES } from "@/config/connectors";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { systemDb, systemTransaction } from "@/lib/system-db";

// Actions stuck in `running` (a crash mid-act: the pipeline set it running and never heard back).
// Nothing sweeps them, because only the partner knows whether it acted: the team checks there, then
// marks it here, done or failed. Marking records what the team found; it moves no money and asks no
// partner for anything. Read across people for /admin/connectors, behind the admin gate.

const WHY = "The team's list of connector actions stuck in running, across everyone";
const MINUTE = 60 * 1000;

export type StuckAction = {
  id: string;
  userId: string;
  connectorId: string;
  kind: string;
  amountCents: number;
  simulated: boolean;
  externalRef: string | null;
  // When it was set running (the row hasn't changed since).
  since: Date;
};

export async function stuckActions({
  client = defaultClient,
  now = new Date(),
}: { client?: PrismaClient; now?: Date } = {}): Promise<StuckAction[]> {
  const rows = await systemDb(WHY, client).connectorAction.findMany({
    where: {
      status: "running",
      updatedAt: { lt: new Date(now.getTime() - CONNECTOR_STUCK_MINUTES * MINUTE) },
    },
    orderBy: { updatedAt: "asc" },
    take: 200,
    select: {
      id: true,
      userId: true,
      connectorId: true,
      kind: true,
      amountCents: true,
      simulated: true,
      externalRef: true,
      updatedAt: true,
    },
  });
  return rows.map(({ updatedAt, ...row }) => ({ ...row, since: updatedAt }));
}

export type StuckOutcome = "succeeded" | "failed";

// What the team found at the partner. Only an action still running and stuck can be marked, once:
// a compare-and-set, so a late webhook or a second tap can't overwrite the other.
export async function markStuck(
  actionId: string,
  outcome: StuckOutcome,
  adminId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<boolean> {
  const db = systemDb(WHY, client);
  const row = await db.connectorAction.findFirst({
    where: { id: actionId },
    select: { userId: true },
  });
  if (!row) return false;
  // The status change and its audit record are one change: an audit that fails undoes the mark,
  // so the team can try again, and a retry never finds a marked action with no record.
  const marked = await systemTransaction(
    WHY,
    async (tx) => {
      const { count } = await tx.connectorAction.updateMany({
        where: {
          id: actionId,
          status: "running",
          updatedAt: { lt: new Date(now.getTime() - CONNECTOR_STUCK_MINUTES * MINUTE) },
        },
        data: { status: outcome, reason: "marked_by_team", finishedAt: now },
      });
      if (count === 0) return false;
      await logAudit(
        { type: "admin", id: adminId },
        "connector_action_marked",
        { type: "connector_action", id: actionId },
        { outcome, user_id: row.userId },
        { tx },
      );
      return true;
    },
    client,
  );
  if (!marked) return false;
  await track(row.userId, "connector_action_marked", { outcome });
  return true;
}
