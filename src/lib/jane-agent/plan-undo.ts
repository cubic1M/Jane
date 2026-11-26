import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { isoDay as today } from "@/lib/dates";
import { parseActions, parseRefs, type MultiResult } from "./types";

// A plan's "Undo the transfer" (multi.undo) works while a transfer is pending and its day has not
// come (src/lib/money-movement/transfers.ts cancelTransfer). These are the checks for that, so
// the chat offers the button, and the "you can undo it until then" line, only while it is true.

type Options = { client?: PrismaClient; now?: Date };

const OPEN_STATUSES = ["pending", "awaiting_partner"];
const UNTIL_THEN = /; you can undo (?:it|the request) until then/g;

// What the plan's note says: how it went, then each step.
export function planNote(results: readonly MultiResult[]): string {
  const failed = results.findIndex((r) => r.status === "failed");
  const lines = results.map(
    (r, i) =>
      `${i + 1}. ${r.status === "done" && !/^(?:un)?done\b/i.test(r.note) ? "Done. " : ""}${r.note}`,
  );
  const head =
    failed < 0
      ? "All done, in order."
      : failed === 0
        ? "I stopped at the first step, so nothing changed."
        : `I stopped at step ${failed + 1}; the steps before it are done.`;
  return [head, ...lines].join("\n");
}

// Which of these transfers can still be taken back.
async function undoable(
  userId: string,
  ids: string[],
  { client = defaultClient, now = new Date() }: Options,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await scopedFor(userId, client).moneyTransfers.findMany({
    where: { id: { in: ids }, status: { in: OPEN_STATUSES } },
    select: { id: true, runOn: true },
  });
  return new Set(rows.filter((r) => today(r.runOn) >= today(now)).map((r) => r.id));
}

async function answeredPlans(userId: string, client: PrismaClient) {
  const rows = await scopedFor(userId, client).janeMessages.findMany({
    where: { status: "answered", actions: { array_contains: [{ id: "multi.undo" }] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, refs: true, actions: true },
  });
  return rows.map((m) => ({
    id: m.id,
    raw: m.refs,
    refs: parseRefs(m.refs),
    actions: parseActions(m.actions),
  }));
}

const idsOf = (results: readonly MultiResult[] | undefined) =>
  (results ?? []).flatMap((r) => (r.transferId ? [r.transferId] : []));

// How many transfers of this person's plans can still be undone, and on which message.
export async function undoablePlan(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ messageId: string; count: number } | null> {
  for (const plan of await answeredPlans(userId, client)) {
    const count = (await undoable(userId, idsOf(plan.refs.multi?.results), { client, now })).size;
    if (count > 0) return { messageId: plan.id, count };
  }
  return null;
}

// A plan whose transfers have gone through (or were cancelled elsewhere) loses its Undo button and
// the "you can undo it until then" lines. The other steps' record stays.
export async function closeSettledPlans(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  let closed = 0;
  for (const plan of await answeredPlans(userId, client)) {
    const results = plan.refs.multi?.results ?? [];
    const live = await undoable(userId, idsOf(results), { client, now });
    if (idsOf(results).every((id) => live.has(id))) continue;
    const next = results.map((r) =>
      r.transferId && !live.has(r.transferId)
        ? { status: r.status, note: r.note.replace(UNTIL_THEN, "") }
        : r,
    );
    // The note is the plan's own while it starts with the record; what a partial Undo added after
    // it ("tap Undo again to retry") stays only while some transfer is still undoable.
    const record = planNote(results);
    const wasNote = plan.refs.note?.startsWith(record) === true;
    const suffix = wasNote && live.size > 0 ? plan.refs.note!.slice(record.length) : "";
    const refs = {
      ...plan.refs,
      multi: { steps: plan.refs.multi?.steps ?? [], results: next },
      ...(wasNote ? { note: planNote(next) + suffix } : {}),
    };
    const actions =
      live.size > 0 ? plan.actions : plan.actions.filter((a) => a.id !== "multi.undo");
    const { count } = await db.janeMessages.updateMany({
      // The refs read above must still be the refs.
      where: {
        id: plan.id,
        status: "answered",
        refs: { equals: plan.raw as Prisma.InputJsonValue },
      },
      data: { refs: refs as Prisma.InputJsonObject, actions: actions as Prisma.InputJsonArray },
    });
    closed += count;
  }
  return closed;
}
