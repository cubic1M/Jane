import { LIFE_EVENTS, isLifeEventKind, type LifeEventKind } from "@/config/life-events";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// Life-event checklists (spec step 72): starting one, ticking its items, finishing and
// deleting it. Always for the signed-in person: every query goes through scopedFor.

type Options = { client?: PrismaClient; now?: Date };

export class LifeEventError extends Error {}

export type LifeEventView = {
  id: string;
  kind: LifeEventKind;
  startedOn: string;
  checkedItems: string[];
  completedAt: Date | null;
};

async function openEvent(userId: string, eventId: string, client: PrismaClient) {
  const event = await scopedFor(userId, client).lifeEvents.findFirst({
    where: { id: eventId },
  });
  if (!event || !isLifeEventKind(event.kind)) {
    throw new LifeEventError("That checklist doesn't exist.");
  }
  return { ...event, kind: event.kind };
}

export async function startLifeEvent(
  userId: string,
  kind: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<string> {
  if (!isLifeEventKind(kind)) throw new LifeEventError("Pick one of the checklists.");
  const db = scopedFor(userId, client);
  const existing = await db.lifeEvents.findFirst({
    where: { kind, completedAt: null },
    select: { id: true },
  });
  if (existing) {
    throw new LifeEventError(
      `You already have a ${LIFE_EVENTS[kind].title.toLowerCase()} checklist going.`,
    );
  }
  const created = await db.lifeEvents.create({
    data: { userId, kind, startedOn: new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`) },
    select: { id: true },
  });
  return created.id;
}

// Ticks the item, or unticks it when it was ticked. Returns whether it's now ticked.
export async function toggleLifeEventItem(
  userId: string,
  eventId: string,
  itemKey: string,
  { client = defaultClient }: Options = {},
): Promise<{ checked: boolean; label: string }> {
  const event = await openEvent(userId, eventId, client);
  const item = LIFE_EVENTS[event.kind].items.find((i) => i.key === itemKey);
  if (!item) throw new LifeEventError("That item isn't on this checklist.");
  const checked = !event.checkedItems.includes(itemKey);
  const checkedItems = checked
    ? [...event.checkedItems, itemKey]
    : event.checkedItems.filter((k) => k !== itemKey);
  await scopedFor(userId, client).lifeEvents.updateMany({
    where: { id: eventId },
    data: { checkedItems },
  });
  return { checked, label: item.label };
}

export async function finishLifeEvent(
  userId: string,
  eventId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<LifeEventKind> {
  const event = await openEvent(userId, eventId, client);
  await scopedFor(userId, client).lifeEvents.updateMany({
    where: { id: eventId, completedAt: null },
    data: { completedAt: now },
  });
  return event.kind;
}

export async function deleteLifeEvent(
  userId: string,
  eventId: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  await scopedFor(userId, client).lifeEvents.deleteMany({ where: { id: eventId } });
}

// Open checklists first, newest first; then finished ones.
export async function listLifeEvents(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<LifeEventView[]> {
  const rows = await scopedFor(userId, client).lifeEvents.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  return rows
    .flatMap((r) =>
      isLifeEventKind(r.kind)
        ? [
            {
              id: r.id,
              kind: r.kind,
              startedOn: r.startedOn.toISOString().slice(0, 10),
              checkedItems: r.checkedItems,
              completedAt: r.completedAt,
            },
          ]
        : [],
    )
    .sort((a, b) => Number(a.completedAt !== null) - Number(b.completedAt !== null));
}
