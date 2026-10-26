import {
  ACCESS_EVENTS,
  ACCESS_LOG_PAGE_SIZE,
  ACTIVITY_LABELS,
  ACTIVITY_ROWS,
  type AccessEvent,
} from "@/config/access-log";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { describeDevice } from "@/lib/devices";

// Reading the access log (src/config/access-log.ts): a person's own recent activity for
// /security, and the team's filtered view at /admin/access-log.

type Options = { client?: PrismaClient };

type Meta = Record<string, unknown>;
const text = (meta: Meta, key: string) =>
  typeof meta[key] === "string" ? (meta[key] as string) : null;

// "Berlin, DE", "DE" or null.
export function placeOf(meta: Meta): string | null {
  return [text(meta, "city"), text(meta, "country")].filter(Boolean).join(", ") || null;
}

export type Activity = {
  id: string;
  at: Date;
  what: string;
  device: string;
  place: string | null;
  failed: boolean;
};

const ACTIVITY_EVENTS = Object.keys(ACTIVITY_LABELS) as AccessEvent[];

// What this person did with their account lately, newest first: their own entries only.
export async function recentActivity(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<Activity[]> {
  const rows = await client.auditLog.findMany({
    where: {
      actorId: userId,
      actorType: { in: ["user", "admin"] },
      event: { in: ACTIVITY_EVENTS },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: ACTIVITY_ROWS,
    select: { id: true, event: true, createdAt: true, metadata: true },
  });
  return rows.map((row) => {
    const meta = (row.metadata ?? {}) as Meta;
    return {
      id: row.id,
      at: row.createdAt,
      what: ACTIVITY_LABELS[row.event as AccessEvent] ?? row.event,
      device: describeDevice(text(meta, "user_agent")),
      place: placeOf(meta),
      failed: meta.outcome === "failure",
    };
  });
}

export type AccessFilters = {
  event: AccessEvent | null;
  actor: string | null;
  ip: string | null;
  outcome: "success" | "failure" | null;
  from: Date | null;
  to: Date | null;
  page: number;
};

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 200) || null;

function day(value: string | null, endOfDay = false): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// The admin page's query string, checked: anything unknown is ignored, never passed through.
export function parseFilters(params: Record<string, string | string[] | undefined>): AccessFilters {
  const event = one(params.event);
  const outcome = one(params.outcome);
  return {
    event: (ACCESS_EVENTS as readonly string[]).includes(event ?? "")
      ? (event as AccessEvent)
      : null,
    actor: one(params.actor),
    ip: one(params.ip),
    outcome: outcome === "success" || outcome === "failure" ? outcome : null,
    from: day(one(params.from)),
    to: day(one(params.to), true),
    page: Math.min(Math.max(Number.parseInt(one(params.page) ?? "1", 10) || 1, 1), 1000),
  };
}

export type AccessEntry = {
  id: string;
  at: Date;
  event: string;
  actor: string;
  target: string | null;
  outcome: string | null;
  ip: string | null;
  place: string | null;
  device: string;
  detail: string | null;
};

// The team's search: access-log entries only, newest first, a page at a time. "actor" is a
// user id or an email address (looked up, never stored on the entry).
export async function searchAccessLog(
  filters: AccessFilters,
  { client = defaultClient }: Options = {},
): Promise<{ entries: AccessEntry[]; more: boolean }> {
  let actorId = filters.actor;
  if (actorId?.includes("@")) {
    const user = await client.user.findUnique({
      where: { email: actorId.toLowerCase() },
      select: { id: true },
    });
    if (!user) return { entries: [], more: false };
    actorId = user.id;
  }
  const where: Prisma.AuditLogWhereInput = {
    event: filters.event ?? { in: [...ACCESS_EVENTS] },
    ...(actorId ? { OR: [{ actorId }, { targetId: actorId }] } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
    AND: [
      ...(filters.ip ? [{ metadata: { path: ["ip"], equals: filters.ip } }] : []),
      ...(filters.outcome ? [{ metadata: { path: ["outcome"], equals: filters.outcome } }] : []),
    ],
  };
  const rows = await client.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (filters.page - 1) * ACCESS_LOG_PAGE_SIZE,
    take: ACCESS_LOG_PAGE_SIZE + 1,
  });
  return {
    more: rows.length > ACCESS_LOG_PAGE_SIZE,
    entries: rows.slice(0, ACCESS_LOG_PAGE_SIZE).map((row) => {
      const meta = (row.metadata ?? {}) as Meta;
      return {
        id: row.id,
        at: row.createdAt,
        event: row.event,
        actor: row.actorId ? `${row.actorType} ${row.actorId}` : row.actorType,
        target: row.targetType ? `${row.targetType} ${row.targetId ?? ""}`.trim() : null,
        outcome: text(meta, "outcome"),
        ip: text(meta, "ip"),
        place: placeOf(meta),
        device: describeDevice(text(meta, "user_agent")),
        detail: text(meta, "path") ?? text(meta, "reason") ?? text(meta, "method"),
      };
    }),
  };
}
