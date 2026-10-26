import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { EVENT_FRESH_DAYS } from "@/config/events";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { checkGuardrails } from "@/lib/guardrails";
import { revertTrade } from "@/lib/paper/account";
import type { EventSlice } from "@/planning/event-overlay";

// The events overlay's updates in the trade pop-up (src/components/trade-popup.tsx): each trade it
// placed by itself, shown once, with OK (seen) and Revert (its paper trades taken back, and the
// slice closed). Advice mode only; each line passes the demo advice guardrail.

type Options = { client?: PrismaClient; now?: Date };

export type EventUpdate = {
  id: string;
  kind: string;
  ticker: string | null;
  headline: string;
  reason: string;
  confidence: number;
  label: string;
  trades: number;
  at: string;
};

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

export function updateHeadline(l: {
  kind: string;
  ticker: string | null;
  side: string | null;
  tilt: number | null;
}) {
  const ticker = l.ticker ?? "a fund";
  if (l.kind === "enter")
    return l.side === "trim"
      ? `Events: moved ${pct(l.tilt ?? 0)} out of ${ticker} to cash`
      : `Events: added ${pct(l.tilt ?? 0)} in ${ticker}`;
  if (l.kind === "stop") return `Events: ${ticker} slice out at its stop`;
  return `Events: ${ticker} slice undone after its time`;
}

export async function eventUpdates(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<EventUpdate[]> {
  if (!(await adviceMode(userId, { client }))) return [];
  const rows = await scopedFor(userId, client).paperEventLogs.findMany({
    where: {
      seenAt: null,
      kind: { in: ["enter", "exit", "stop"] },
      at: { gte: new Date(now.getTime() - EVENT_FRESH_DAYS * 86_400_000) },
      NOT: { tradeIds: { isEmpty: true } },
    },
    orderBy: { at: "desc" },
    take: 10,
  });
  return rows.flatMap((r) => {
    const headline = updateHeadline(r);
    if (!checkGuardrails(`${headline}. ${r.reason}`, [], undefined, "demo_advice").ok) return [];
    return [
      {
        id: r.id,
        kind: r.kind,
        ticker: r.ticker,
        headline,
        reason: r.reason,
        confidence: r.confidence,
        label: DEMO_ADVICE_LABEL,
        trades: r.tradeIds.length,
        at: r.at.toISOString(),
      },
    ];
  });
}

export async function markEventSeen(
  userId: string,
  id: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ ok: boolean }> {
  const changed = await scopedFor(userId, client).paperEventLogs.updateMany({
    where: { id, seenAt: null },
    data: { seenAt: now },
  });
  return { ok: changed.count > 0 };
}

// Revert: the action's paper trades taken back, newest first (so each one's cash is there), and an
// opened slice closed, so its exit doesn't trade again.
export async function revertEventAction(
  userId: string,
  id: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = scopedFor(userId, client);
  const log = await db.paperEventLogs.findFirst({ where: { id } });
  if (!log || log.tradeIds.length === 0) return { ok: false, error: "That can't be taken back." };
  for (const tradeId of [...log.tradeIds].reverse()) {
    const r = await revertTrade(userId, tradeId, { client, now });
    if (!r.ok) return r;
  }
  // The reverted trades' signals would wait in the pop-up again: they were the overlay's, so they
  // are put away instead.
  const trades = await db.paperTrades.findMany({
    where: { id: { in: log.tradeIds } },
    select: { signalId: true },
  });
  await db.paperSignals.updateMany({
    where: { id: { in: trades.flatMap((t) => (t.signalId ? [t.signalId] : [])) } },
    data: { status: "skipped", decidedAt: now },
  });
  if (log.kind === "enter") {
    const overlay = await db.paperEventOverlays.findFirst({});
    if (overlay) {
      const state = (overlay.state ?? {}) as { open?: EventSlice[] };
      await db.paperEventOverlays.update({
        where: { id: overlay.id },
        data: {
          state: {
            ...(overlay.state as object),
            open: (state.open ?? []).filter(
              (s) => !(s.eventKey === log.eventKey && s.ticker === log.ticker),
            ),
          } as Prisma.InputJsonValue,
        },
      });
    }
  }
  await db.paperEventLogs.update({ where: { id }, data: { seenAt: now } });
  return { ok: true };
}
