import { DEMO_ADVICE_LABEL } from "@/config/advice";
import {
  EVENT_EVIDENCE,
  EVENT_EVIDENCE_CRYPTO,
  EVENT_EVIDENCE_RANGE,
  EVENT_EVIDENCE_SUMMARY,
} from "@/config/event-evidence";
import {
  EVENT_FRESH_DAYS,
  EVENT_SOURCE_LABELS,
  EVENT_STORE_DAYS,
  EVENT_HOLD_DAYS,
  EVENT_MIN_CONFIDENCE,
  EVENT_TILT_BY_LEVEL,
  EVENT_TYPES,
  eventTypesFor,
  type EventMarket,
  type EventTypeId,
} from "@/config/events";
import type { RiskLevel } from "@/config/investing";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { checkGuardrails } from "@/lib/guardrails";
import { confidenceFor, type ClosedSlice, type EventSlice } from "@/planning/event-overlay";
import { lastRefresh } from "./refresh";
import { formatPercentTenths } from "@/lib/percent";

// The Events box on the investments page (founder, 2026-10-26): what's happening now, what the
// overlay would do or did, how sure it is, its track record, and its switch. From what is stored:
// nothing is fetched. Demo advice only (advice mode), so a real account gets no box. Every line
// of text passes the demo advice guardrail; one that doesn't is left out.

type Options = { client?: PrismaClient; now?: Date };

export type EventsView = {
  on: boolean;
  // What it watches and when it last looked (never a blank box).
  watching: { sources: { label: string; ok: boolean }[]; lastChecked: string | null };
  // Nothing fresh: the box says so, and shows the most recent events from before (`earlier`).
  quiet: boolean;
  // The 24-hour agent runs the paper account: it takes the overlay's slices as its own signals.
  agent: boolean;
  hasAccount: boolean;
  level: RiskLevel | null;
  label: string;
  now: {
    key: string;
    date: string;
    label: string;
    theme: string;
    title: string;
    source: string;
    url: string | null;
    confidence: number;
    // What it would do (off) or did (on), in a line.
    plan: string;
    acting: boolean;
  }[];
  // The most recent events from before the fresh window, when it is quiet: shown, not acted on.
  earlier: { key: string; date: string; label: string; title: string; why: string }[];
  open: { ticker: string; side: string; tilt: number; enteredOn: string; reason: string }[];
  recent: {
    id: string;
    date: string;
    kind: string;
    ticker: string | null;
    eventTitle: string;
    reason: string;
    confidence: number;
  }[];
  record: { type: EventTypeId; label: string; events: number; hits: number; confidence: number }[];
  // The market whose events it shows: crypto for the 24-hour agent on crypto, else stock funds.
  market: EventMarket;
  backtest: {
    from: string;
    to: string;
    level: number;
    alone: { yearly: number; maxDrawdown: number; sharpe: number };
    withEvents: { yearly: number; maxDrawdown: number; sharpe: number };
  };
};

const DAY_MS = 86_400_000;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const safe = (text: string) => checkGuardrails(text, [], undefined, "demo_advice").ok;

export async function loadEventsView(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<EventsView | null> {
  if (!(await adviceMode(userId, { client }))) return null;
  const db = scopedFor(userId, client);
  // The 24-hour agent on crypto trades the crypto events; every other strategy, the stock-fund ones.
  const agentMarket = (
    await db.paperAccounts.findFirst({ select: { agentPolicy: true, agentMarket: true } })
  )?.agentMarket;
  const market: EventMarket = agentMarket === "crypto" ? "crypto" : "stocks";
  const [account, overlay, logs, events] = await Promise.all([
    db.paperAccounts.findFirst({
      select: { id: true, level: true, agentPolicy: true, agentMarket: true },
    }),
    db.paperEventOverlays.findFirst({}),
    db.paperEventLogs.findMany({ orderBy: { at: "desc" }, take: 12 }),
    client.marketEvent.findMany({
      where: {
        knownAt: { lte: now },
        date: { gte: new Date(now.getTime() - EVENT_STORE_DAYS * DAY_MS) },
        type: { in: eventTypesFor(market) },
      },
      orderBy: { knownAt: "desc" },
      take: 12,
    }),
  ]);
  const freshFrom = dayOf(new Date(now.getTime() - EVENT_FRESH_DAYS * DAY_MS));
  const fresh = events.filter((e) => dayOf(e.date) >= freshFrom).slice(0, 8);
  const older = events.filter((e) => dayOf(e.date) < freshFrom);
  const checked = await lastRefresh({ client });
  const level = (account?.level ?? null) as RiskLevel | null;
  const state = (overlay?.state ?? {}) as { open?: EventSlice[]; closed?: ClosedSlice[] };
  const closed = state.closed ?? [];
  // On by default: only switched off (or another account's row) is off.
  const on = Boolean(account && (overlay ? overlay.on && overlay.accountId === account.id : true));
  const acted = new Map(logs.map((l) => [l.eventKey, l]));

  const nowRows = fresh.flatMap((e) => {
    const type = EVENT_TYPES[e.type as EventTypeId];
    if (!type) return [];
    const confidence = confidenceFor(e.type as EventTypeId, closed, EVENT_EVIDENCE);
    const tilt = level ? EVENT_TILT_BY_LEVEL[level] : EVENT_TILT_BY_LEVEL[3];
    const funds = type.legs.map((l) => `${l.side === "buy" ? "+" : "−"}${l.tickers[0]}`).join(" ");
    const log = acted.get(e.key);
    const plan = log
      ? log.kind === "skip"
        ? `Not acted on: ${log.reason.split("Not acted on: ")[1] ?? "see the log"}`
        : `Did: ${funds}, ${formatPercentTenths(tilt)} of the account for up to ${EVENT_HOLD_DAYS} trading days`
      : confidence < EVENT_MIN_CONFIDENCE
        ? `Would wait: its record is ${confidence}% sure, under ${EVENT_MIN_CONFIDENCE}%`
        : `${on ? "Will" : "Would"} tilt ${funds}, ${formatPercentTenths(tilt)} of the account for up to ${EVENT_HOLD_DAYS} trading days`;
    const row = {
      key: e.key,
      date: dayOf(e.date),
      label: type.label,
      theme: type.theme,
      title: e.title,
      source: e.source,
      url: e.url,
      confidence,
      plan,
      acting:
        Boolean(log && log.kind !== "skip") || (on && !log && confidence >= EVENT_MIN_CONFIDENCE),
    };
    return safe(`${row.title}. ${row.plan}`) ? [row] : [];
  });

  const record = eventTypesFor(market).map((type) => {
    const live = new Map<string, boolean[]>();
    for (const c of closed)
      if (c.type === type) live.set(c.eventKey, [...(live.get(c.eventKey) ?? []), c.hit]);
    const liveHits = [...live.values()].reduce(
      (a, h) => a + h.filter(Boolean).length / h.length,
      0,
    );
    return {
      type,
      label: EVENT_TYPES[type].label,
      events: EVENT_EVIDENCE[type].events + live.size,
      hits: Math.round((EVENT_EVIDENCE[type].hits + liveHits) * 10) / 10,
      confidence: confidenceFor(type, closed, EVENT_EVIDENCE),
    };
  });

  // Calendar days between the event's day and today's.
  const daysAgo = (d: Date) =>
    Math.round((Date.parse(`${dayOf(now)}T00:00:00Z`) - d.getTime()) / DAY_MS);
  const earlier = older.slice(0, 3).flatMap((e) => {
    const type = EVENT_TYPES[e.type as EventTypeId];
    if (!type) return [];
    const row = {
      key: e.key,
      date: dayOf(e.date),
      label: type.label,
      title: e.title,
      why: `${daysAgo(e.date)} days ago: older than ${EVENT_FRESH_DAYS} days, so not acted on`,
    };
    return safe(`${row.title}. ${row.why}`) ? [row] : [];
  });

  return {
    on,
    watching: {
      sources: Object.entries(EVENT_SOURCE_LABELS).map(([key, label]) => ({
        label,
        ok: checked?.sources[key] !== "failed",
      })),
      lastChecked: checked?.checkedAt ?? null,
    },
    quiet: nowRows.length === 0,
    earlier,
    agent: Boolean(account?.agentPolicy),
    hasAccount: Boolean(account),
    level,
    label: DEMO_ADVICE_LABEL,
    now: nowRows,
    open: (state.open ?? []).map((s) => ({
      ticker: s.ticker,
      side: s.side,
      tilt: s.tilt,
      enteredOn: s.enteredOn,
      reason: s.reason,
    })),
    recent: logs
      .filter((l) => safe(l.reason))
      .map((l) => ({
        id: l.id,
        date: dayOf(l.date),
        kind: l.kind,
        ticker: l.ticker,
        eventTitle: l.eventTitle,
        reason: l.reason,
        confidence: l.confidence,
      })),
    record,
    market,
    backtest:
      market === "crypto"
        ? {
            from: EVENT_EVIDENCE_CRYPTO.from,
            to: EVENT_EVIDENCE_CRYPTO.to,
            level: EVENT_EVIDENCE_RANGE.level,
            alone: EVENT_EVIDENCE_CRYPTO.alone,
            withEvents: EVENT_EVIDENCE_CRYPTO.withEvents,
          }
        : { ...EVENT_EVIDENCE_RANGE, ...EVENT_EVIDENCE_SUMMARY },
  };
}
