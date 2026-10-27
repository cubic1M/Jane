import { ACTIVITY, ACTIVITY_KINDS, ANONYMOUS_PAGES, type ActivityKind } from "@/config/activity";
import { cleanName, normalizePath, redactText } from "./redact";

// The server's check on what the browser sent to POST /api/activity: unknown kinds and keys
// are dropped, text is redacted again, and only counts and flags survive in `data`. Whatever
// the browser sends, a typed value has nowhere to go.

export type ActivityRow = {
  visitId: string;
  kind: ActivityKind;
  path: string;
  role: string | null;
  label: string | null;
  data: ActivityData;
  createdAt: Date;
};

export type ActivityData = {
  ms?: number;
  count?: number;
  typed?: boolean;
  length?: number;
  private?: boolean;
  fields?: string[];
};

const VISIT_ID = /^[a-z0-9]{8,40}$/i;
const ROLE = /^[a-z-]{1,20}$/;

const isKind = (k: unknown): k is ActivityKind =>
  typeof k === "string" && (ACTIVITY_KINDS as readonly string[]).includes(k);

const int = (v: unknown, max: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : undefined;

function cleanData(kind: ActivityKind, raw: unknown): ActivityData {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: ActivityData = {};
  if (kind === "page_time" || kind === "submit") out.ms = int(d.ms, 24 * 60 * 60 * 1000);
  if (kind === "rage_click") out.count = int(d.count, 100);
  if (kind === "blur") {
    out.typed = d.typed === true;
    out.private = d.private === true;
    // A private field's length could hint at what's in it (an amount's digits).
    if (!out.private) out.length = int(d.length, 100_000);
  }
  if (kind === "submit" && Array.isArray(d.fields)) {
    out.fields = d.fields
      .filter((f): f is string => typeof f === "string")
      .slice(0, ACTIVITY.maxFields)
      .map(cleanName)
      .filter(Boolean);
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

function cleanEvent(raw: unknown, visitId: string, now: Date): ActivityRow | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (!isKind(e.kind) || typeof e.path !== "string" || !e.path.startsWith("/")) return null;
  const kind = e.kind;
  const at = typeof e.at === "number" ? e.at : NaN;
  const skew = now.getTime() - at;
  const createdAt = skew >= -60_000 && skew <= ACTIVITY.maxClockSkewMs ? new Date(at) : now;
  const label =
    typeof e.label !== "string" || !e.label
      ? null
      : kind === "error"
        ? redactText(e.label, ACTIVITY.maxError)
        : kind === "submit" || kind === "focus" || kind === "blur"
          ? cleanName(e.label)
          : redactText(e.label);
  return {
    visitId,
    kind,
    path: normalizePath(e.path),
    role: typeof e.role === "string" && ROLE.test(e.role) ? e.role : null,
    label: label || null,
    data: cleanData(kind, e.data),
    createdAt,
  };
}

export type Batch = { visitId: string; events: ActivityRow[] };

// Null when the body isn't a batch at all.
export function sanitizeBatch(body: unknown, now: Date = new Date()): Batch | null {
  if (!body || typeof body !== "object") return null;
  const { visitId, events } = body as { visitId?: unknown; events?: unknown };
  if (typeof visitId !== "string" || !VISIT_ID.test(visitId) || !Array.isArray(events)) {
    return null;
  }
  return {
    visitId,
    events: events
      .slice(0, ACTIVITY.maxBatch)
      .map((e) => cleanEvent(e, visitId, now))
      .filter((e): e is ActivityRow => e !== null),
  };
}

// Before sign-in, only views of the landing page are kept.
export function anonymousOnly(rows: ActivityRow[]): ActivityRow[] {
  return rows.filter((r) => r.kind === "page_view" && ANONYMOUS_PAGES.includes(r.path));
}
