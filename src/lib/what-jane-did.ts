import { actionWorthCents } from "@/lib/saved-amount";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { DAY_MS } from "@/lib/dates";

// What the action agent did for the person (spec step 56): what it finished, the money it
// confirmed (a refund seen in their transactions, a lower price confirmed on a call: never
// an estimate), what it's still working on, and what waits on the person.

export type JaneDid = {
  // The action and when it finished, for Jane's "I did this" messages (spec step 82).
  finished: {
    actionId: string;
    title: string;
    confirmedCents: number | null;
    completedAt: Date | null;
  }[];
  confirmedCents: number;
  // Emails and calls the agent made.
  contacts: number;
  working: number;
  waiting: { title: string; todo: string }[];
};

const WEEK_DAYS = 7;

const titleOf = (snapshot: unknown) => {
  const title = (snapshot as { title?: unknown } | null)?.title;
  return typeof title === "string" ? title : "Your request";
};

export async function whatJaneDid(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    days = WEEK_DAYS,
  }: { client?: PrismaClient; now?: Date; days?: number } = {},
): Promise<JaneDid> {
  const db = scopedFor(userId, client);
  const since = new Date(now.getTime() - days * DAY_MS);
  const [finished, open, contacts] = await Promise.all([
    db.actions.findMany({
      where: { agentState: "finished", status: "done", completedAt: { gte: since } },
      select: {
        id: true,
        refundCents: true,
        confirmedAnnualCents: true,
        completedAt: true,
        decision: { select: { cardSnapshot: true } },
      },
      orderBy: { completedAt: "asc" },
    }),
    db.actions.findMany({
      where: {
        agentState: { in: ["working", "waiting_reply", "confirming"] },
        status: { in: ["queued", "in_progress", "waiting_on_user"] },
      },
      select: { status: true, userTodo: true, decision: { select: { cardSnapshot: true } } },
    }),
    db.agentMessages.count({ where: { direction: "outbound", createdAt: { gte: since } } }),
  ]);
  const rows = finished.map((a) => ({
    actionId: a.id,
    title: titleOf(a.decision.cardSnapshot),
    confirmedCents: actionWorthCents(a),
    completedAt: a.completedAt,
  }));
  return {
    finished: rows,
    confirmedCents: rows.reduce((sum, r) => sum + (r.confirmedCents ?? 0), 0),
    contacts,
    working: open.filter((a) => a.status !== "waiting_on_user").length,
    waiting: open
      .filter((a) => a.status === "waiting_on_user")
      .map((a) => ({
        title: titleOf(a.decision.cardSnapshot),
        todo: a.userTodo ?? "See your actions page.",
      })),
  };
}

// Whether there's anything to show.
export const janeDidSomething = (did: JaneDid) =>
  did.finished.length > 0 || did.contacts > 0 || did.working > 0 || did.waiting.length > 0;
