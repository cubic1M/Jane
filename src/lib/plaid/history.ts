import {
  DAYS_REQUESTED_BEFORE_MAX,
  HISTORY_CATCH_UP_MAX_DAYS,
  HISTORY_COMPLETE,
  HISTORY_GRACE_HOURS,
  HISTORY_RESCAN_AFTER_DAYS,
  HISTORY_SLACK_DAYS,
  MAX_DAYS_REQUESTED_FROM,
  TRANSACTION_DAYS_REQUESTED,
} from "@/config/plaid";
import { addDays, daysBetween } from "@/detection/units";
import type { PrismaClient } from "@/generated/prisma/client";
import { safeMetadata } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { isoDay } from "@/lib/dates";
import { scopedFor, type ScopedDb } from "@/lib/db-scoped";
import { systemDb } from "@/lib/system-db";

// How far back each linked bank's history goes, so it is never a guess (founder 11-28: "it's only
// showing oct 19 to now"). What Plaid said (/transactions/sync's transactions_update_status:
// NOT_READY, INITIAL_UPDATE_COMPLETE or HISTORICAL_UPDATE_COMPLETE, plaid.com/docs/api/products/transactions/,
// read 2026-11-28), what is held, and when things last moved are written as a note in audit_log
// ("plaid_history_checked", counts, days and Plaid's status word only: never a token, an account
// number or a transaction) at the end of each sync, and only when something changed or a day has
// passed. No table of its own.

export const HISTORY_EVENT = "plaid_history_checked";
const WHY =
  "Bank history: the audit log is the system's record; reads are narrowed to the link's id";

export type HeldHistory = { earliest: string | null; latest: string | null; count: number };

export type HistoryNote = HeldHistory & {
  // Plaid's transactions_update_status at the last sync, or "UNKNOWN" if it gave none.
  status: string;
  daysRequested: number;
  checkedAt: Date;
  // The last time the saved cursor moved (Plaid had something new), and the one time the link was
  // read again from the start.
  cursorMovedAt: string | null;
  rescannedAt: string | null;
};

// Links made before the maximum was asked for (#2398) asked for 365 days.
export const daysRequestedFor = (linkedAt: Date): number =>
  linkedAt < new Date(MAX_DAYS_REQUESTED_FROM)
    ? DAYS_REQUESTED_BEFORE_MAX
    : TRANSACTION_DAYS_REQUESTED;

// Whether what is held reaches back as far as was asked, give or take the slack.
export function holdsAllAsked(
  held: HeldHistory,
  linkedAt: Date,
  daysRequested: number = daysRequestedFor(linkedAt),
): boolean {
  if (!held.earliest) return false;
  const asked = addDays(isoDay(linkedAt), -daysRequested);
  return daysBetween(asked, held.earliest) <= HISTORY_SLACK_DAYS;
}

type Judged = {
  held: HeldHistory;
  status: string | null;
  linkedAt: Date;
  rescannedAt: string | null;
  now: Date;
};

// Read the link again from an empty cursor, once: Plaid's docs say a call without a cursor returns the
// entire history of updates, so a cursor that was saved past older data is cured by it. Only for a
// link that holds less than it asked for, has had a day to settle, and either says its history is
// complete (so what it holds should be all) or has been short for days.
export function rescanDue({ held, status, linkedAt, rescannedAt, now }: Judged): boolean {
  if (rescannedAt || holdsAllAsked(held, linkedAt)) return false;
  const ageHours = (now.getTime() - linkedAt.getTime()) / 3_600_000;
  if (ageHours < HISTORY_GRACE_HOURS) return false;
  return status === HISTORY_COMPLETE || ageHours >= HISTORY_RESCAN_AFTER_DAYS * 24;
}

// The one tap: Plaid says the history is complete, the link was read again from the start, and it
// still holds less than it asked for, and it asked for less than a new link would (a new link asking
// for the maximum can be longer; one that already asked for it cannot).
export function offerFullHistory(j: Judged): boolean {
  return (
    j.status === HISTORY_COMPLETE &&
    j.rescannedAt !== null &&
    !holdsAllAsked(j.held, j.linkedAt) &&
    daysRequestedFor(j.linkedAt) < TRANSACTION_DAYS_REQUESTED
  );
}

export type HistoryLine = {
  state: "complete" | "pending" | "unknown" | "empty";
  text: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayWords = (day: string): string => {
  const [y, m, d] = day.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

// The person's sentence, in plain facts.
export function historyLine(bank: string, held: HeldHistory, status: string | null): HistoryLine {
  if (!held.earliest) {
    return { state: "empty", text: `History from ${bank}: nothing yet. Jane is still reading it.` };
  }
  const range = `History from ${bank}: ${dayWords(held.earliest)} to today`;
  if (status === HISTORY_COMPLETE) {
    return { state: "complete", text: `${range} (this is everything ${bank} gave).` };
  }
  if (status === null || status === "UNKNOWN" || status === "TRANSACTIONS_UPDATE_STATUS_UNKNOWN") {
    return { state: "unknown", text: `${range} (Jane is checking how far back ${bank} goes).` };
  }
  return { state: "pending", text: `${range} (Plaid is still sending older history).` };
}

function parse(row: { metadata: unknown; createdAt: Date }): HistoryNote | null {
  const m = (row.metadata ?? {}) as Record<string, unknown>;
  if (typeof m.status !== "string") return null;
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    status: m.status,
    daysRequested: typeof m.daysRequested === "number" ? m.daysRequested : 0,
    earliest: text(m.earliest),
    latest: text(m.latest),
    count: typeof m.count === "number" ? m.count : 0,
    cursorMovedAt: text(m.cursorMovedAt),
    rescannedAt: text(m.rescannedAt),
    checkedAt: row.createdAt,
  };
}

// The latest note of each link. A system read of the audit log, narrowed to the given links.
export async function latestNotes(
  itemIds: readonly string[],
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<Map<string, HistoryNote>> {
  if (itemIds.length === 0) return new Map();
  const rows = await systemDb(WHY, client).auditLog.findMany({
    where: { event: HISTORY_EVENT, targetType: "plaid_item", targetId: { in: [...itemIds] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    distinct: ["targetId"],
    select: { targetId: true, metadata: true, createdAt: true },
  });
  const notes = new Map<string, HistoryNote>();
  for (const row of rows) {
    const note = row.targetId ? parse(row) : null;
    if (note && row.targetId) notes.set(row.targetId, note);
  }
  return notes;
}

// What a link's accounts hold now.
export async function heldHistory(db: ScopedDb, itemId: string): Promise<HeldHistory> {
  const r = await db.transactions.aggregate({
    where: { account: { itemId }, source: "plaid" },
    _min: { date: true },
    _max: { date: true },
    _count: { _all: true },
  });
  return {
    earliest: r._min.date ? isoDay(r._min.date) : null,
    latest: r._max.date ? isoDay(r._max.date) : null,
    count: r._count._all,
  };
}

// The note after a sync. Written when something changed or a day has passed since the last one.
export async function recordHistory(
  db: ScopedDb,
  item: { id: string; createdAt: Date },
  after: {
    status: string | null;
    cursorMoved: boolean;
    rescanned: boolean;
    previous: HistoryNote | null;
    now: Date;
  },
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<HistoryNote> {
  const held = await heldHistory(db, item.id);
  const { previous, now } = after;
  const note: HistoryNote = {
    ...held,
    status: after.status ?? "UNKNOWN",
    daysRequested: daysRequestedFor(item.createdAt),
    checkedAt: now,
    cursorMovedAt: after.cursorMoved ? now.toISOString() : (previous?.cursorMovedAt ?? null),
    rescannedAt: after.rescanned ? now.toISOString() : (previous?.rescannedAt ?? null),
  };
  const same =
    previous &&
    previous.status === note.status &&
    previous.earliest === note.earliest &&
    previous.latest === note.latest &&
    previous.count === note.count &&
    previous.cursorMovedAt === note.cursorMovedAt &&
    previous.rescannedAt === note.rescannedAt;
  if (same && now.getTime() - previous.checkedAt.getTime() < 20 * 3_600_000) return note;
  await systemDb(WHY, client).auditLog.create({
    data: {
      actorType: "system",
      actorId: null,
      event: HISTORY_EVENT,
      targetType: "plaid_item",
      targetId: item.id,
      createdAt: now,
      metadata: safeMetadata({
        status: note.status,
        daysRequested: note.daysRequested,
        earliest: note.earliest,
        latest: note.latest,
        count: note.count,
        cursorMovedAt: note.cursorMovedAt,
        rescannedAt: note.rescannedAt,
      }),
    },
  });
  return note;
}

export type ItemHistory = {
  itemId: string;
  bank: string;
  linkedAt: Date;
  lastSyncedAt: Date | null;
  held: HeldHistory;
  note: HistoryNote | null;
  line: HistoryLine;
  // The one tap is on offer (see offerFullHistory).
  offer: boolean;
  // Plaid's webhook codes for this link in the last days (they are kept WEBHOOK_EVENT_DAYS).
  webhookCodes: string[];
  // Still not complete and past the days the nightly job keeps asking.
  stuck: boolean;
};

type ItemRow = {
  id: string;
  institutionName: string | null;
  createdAt: Date;
  lastSyncedAt: Date | null;
  plaidItemId: string;
};

async function describe(
  rows: ItemRow[],
  held: (itemId: string) => Promise<HeldHistory>,
  now: Date,
  client: PrismaClient,
): Promise<ItemHistory[]> {
  const notes = await latestNotes(
    rows.map((r) => r.id),
    { client },
  );
  const webhooks = rows.length
    ? await systemDb(WHY, client).plaidWebhookEvent.findMany({
        where: { plaidItemId: { in: rows.map((r) => r.plaidItemId) } },
        orderBy: { receivedAt: "desc" },
        select: { plaidItemId: true, webhookCode: true },
        take: 40 * rows.length,
      })
    : [];
  return Promise.all(
    rows.map(async (r) => {
      const note = notes.get(r.id) ?? null;
      const now_ = await held(r.id);
      const bank = r.institutionName ?? "your bank";
      const judged: Judged = {
        held: now_,
        status: note?.status ?? null,
        linkedAt: r.createdAt,
        rescannedAt: note?.rescannedAt ?? null,
        now,
      };
      const codes: string[] = [];
      for (const w of webhooks) {
        if (w.plaidItemId === r.plaidItemId && !codes.includes(w.webhookCode) && codes.length < 5) {
          codes.push(w.webhookCode);
        }
      }
      return {
        itemId: r.id,
        bank,
        linkedAt: r.createdAt,
        lastSyncedAt: r.lastSyncedAt,
        held: now_,
        note,
        line: historyLine(bank, now_, note?.status ?? null),
        offer: offerFullHistory(judged),
        webhookCodes: codes,
        stuck:
          note?.status !== HISTORY_COMPLETE &&
          now.getTime() - r.createdAt.getTime() > HISTORY_CATCH_UP_MAX_DAYS * 86_400_000,
      };
    }),
  );
}

const SELECT = {
  id: true,
  institutionName: true,
  createdAt: true,
  lastSyncedAt: true,
  plaidItemId: true,
} as const;

// One person's banks, for the page that lists their accounts.
export async function historyForPerson(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<ItemHistory[]> {
  const db = scopedFor(userId, client);
  const rows = await db.plaidItems.findMany({ select: SELECT, orderBy: { createdAt: "asc" } });
  return describe(rows, (id) => heldHistory(db, id), now, client);
}

// Every real person's banks, for the team (/admin/history, behind admin 2FA).
export async function historyForTeam({
  client = defaultClient,
  now = new Date(),
}: { client?: PrismaClient; now?: Date } = {}): Promise<(ItemHistory & { userId: string })[]> {
  const rows = await systemDb(
    "Admin history page: every linked bank's history",
    client,
  ).plaidItem.findMany({
    select: { ...SELECT, userId: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const out = await describe(
    rows,
    async (id) => {
      const owner = rows.find((r) => r.id === id)!.userId;
      return heldHistory(scopedFor(owner, client), id);
    },
    now,
    client,
  );
  return out.map((o, i) => ({ ...o, userId: rows[i].userId }));
}

// Links the nightly job reads whatever their last sync: not complete at Plaid yet (or never judged),
// and young enough to be worth it. Bounded by HISTORY_CATCH_UP_MAX_DAYS.
export async function itemsStillCatchingUp(
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
  userFilter: object,
): Promise<string[]> {
  const found: string[] = [];
  // In pages by id, so complete links never crowd out the incomplete ones.
  for (let after: string | undefined; found.length < 200;) {
    const page = await systemDb(
      "Cron: finds banks whose history isn't complete yet",
      client,
    ).plaidItem.findMany({
      where: {
        status: "active",
        userId: userFilter,
        createdAt: { gt: new Date(now.getTime() - HISTORY_CATCH_UP_MAX_DAYS * 86_400_000) },
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 200,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    const notes = await latestNotes(
      page.map((i) => i.id),
      { client },
    );
    found.push(
      ...page.filter((i) => notes.get(i.id)?.status !== HISTORY_COMPLETE).map((i) => i.id),
    );
    after = page[page.length - 1].id;
  }
  return found;
}
