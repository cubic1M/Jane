import { SECTOR_LABELS, type Sector } from "@/config/autopilot-sectors";
import { RULE_ACT_PREFIX } from "@/config/rules";
import type { ActionStatus, ActionType, PrismaClient } from "@/generated/prisma/client";
import { ACTION_STATUS_LABELS } from "@/lib/action-status";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { doneSaving, snapshotTitle } from "@/lib/hubs/jane";
import { formatCents } from "@/lib/money";

// Everything Jane did (spec step 187): one honest record across sectors. Every act through a
// specialist passes the permission check (src/lib/permission/check.ts), which writes it to
// jane_acts, so each appears here with its reason and says when nothing real happened. Older acts
// and what isn't through a specialist come from autopilot_acts (recordAct,
// src/lib/sector-autopilot.ts), transfers the person tapped, standing rules' yeses and what followed
// a person's yes on a card (debugger 11-02: "nothing yet" right after a Yes, with money saved), each
// listed once. Transfers still pending can be undone from /transfers.

export type TimelineEntry = {
  id: string;
  at: Date;
  sector: string;
  sectorLabel: string;
  by: "jane" | "you";
  what: string;
  why: string;
  cents: number | null;
  // Where to undo it while it still can be, or null.
  undoHref: string | null;
  // Through a stand-in: nothing real happened, and the record says so.
  simulated: boolean;
  // The agent's work on it, oldest first: what was sent and what came back.
  steps: { label: "Sent" | "Came back"; text: string }[];
  // The act a mistake can be reported on, or null.
  actId: string | null;
  // Reported as wrong already.
  reported: boolean;
};

// An act and its older row (a recordAct, or a transfer) are one thing when they match this closely.
const SAME_ACT_MS = 5 * 60 * 1000;
// How much of an action's back-and-forth is shown.
const MAX_STEPS = 6;

// The older rows left once each is matched, one to one, against an act that already says it.
export function notYetListed<T extends { sector: string; cents: number | null; at: Date }>(
  rows: readonly T[],
  acts: readonly { sector: string; cents: number; at: Date }[],
): T[] {
  const left = [...acts];
  return rows.filter((row) => {
    const i = left.findIndex(
      (a) =>
        a.sector === row.sector &&
        a.cents === (row.cents ?? 0) &&
        Math.abs(a.at.getTime() - row.at.getTime()) <= SAME_ACT_MS,
    );
    if (i === -1) return true;
    left.splice(i, 1);
    return false;
  });
}

const labelOf = (sector: string) => SECTOR_LABELS[sector as Sector] ?? "Other";

const ACTION_SECTOR: Record<ActionType, Sector> = {
  cancel_subscription: "bills",
  fight_price_increase: "bills",
  recover_bank_fees: "bills",
  review_cash_flow: "bills",
  request_refund: "bills",
  negotiate_bill: "bills",
  move_idle_cash: "goals",
  insurance_reshop: "insurance",
  card_interest: "debt",
};

// Why an action is listed: Jane's latest word on it, or where it stands since the person's yes.
function actionWhy(action: {
  status: ActionStatus;
  refundCents: number | null;
  confirmedAnnualCents: number | null;
  decision: { cardSnapshot: unknown };
  agentMessages: {
    body: string;
    summary: string | null;
    direction: string;
    subject: string | null;
  }[];
}): string {
  if (action.status === "done") {
    const saving = doneSaving({ ...action, cardSnapshot: action.decision.cardSnapshot });
    if (!saving) return "You said yes. Done.";
    return `You said yes. Done: ${saving[0].toLowerCase()}${saving.slice(1)}.`;
  }
  const latest = action.agentMessages[0];
  const said = latest?.direction === "note" ? latest.body : latest?.summary;
  return said || `You said yes. ${ACTION_STATUS_LABELS[action.status].label}.`;
}

// What was sent and what came back, oldest first.
function stepsOf(
  messages: readonly {
    direction: string;
    subject: string | null;
    summary: string | null;
    body: string;
  }[],
): TimelineEntry["steps"] {
  // Jane's own notes are already the entry's why.
  return [...messages]
    .reverse()
    .filter((m) => m.direction !== "note")
    .map((m) => ({
      label: m.direction === "outbound" ? "Sent" : "Came back",
      text: (m.direction === "outbound" ? (m.subject ?? m.body) : (m.summary ?? m.body)).slice(
        0,
        200,
      ),
    }));
}

export async function loadTimeline(
  userId: string,
  {
    client = defaultClient,
    limit = 50,
    now = new Date(),
  }: { client?: PrismaClient; limit?: number; now?: Date } = {},
): Promise<TimelineEntry[]> {
  const db = scopedFor(userId, client);
  const [janeActs, acts, transfers, rules, actions] = await Promise.all([
    db.janeActs.findMany({
      where: { status: "done" },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      include: { mistake: { select: { id: true } } },
    }),
    db.autopilotActs.findMany({
      // A rule's yes is listed once, as the rule's decision below (gap audit: it showed twice).
      where: { NOT: { what: { startsWith: RULE_ACT_PREFIX } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      select: { id: true, sector: true, cents: true, what: true, createdAt: true },
    }),
    db.moneyTransfers.findMany({
      where: { by: "person" },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        sector: true,
        toName: true,
        amountCents: true,
        status: true,
        createdAt: true,
      },
    }),
    db.decisions.findMany({
      where: { source: "rule", choice: "yes" },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      select: { id: true, cardSnapshot: true, createdAt: true, ruleKey: true },
    }),
    // A rule's yes is listed above, as the rule's decision.
    db.actions.findMany({
      where: { decision: { undoneAt: null, source: { not: "rule" } } },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        type: true,
        status: true,
        refundCents: true,
        updatedAt: true,
        confirmedAnnualCents: true,
        decision: { select: { cardSnapshot: true } },
        agentMessages: {
          orderBy: { createdAt: "desc" },
          take: MAX_STEPS,
          select: { id: true, body: true, summary: true, direction: true, subject: true },
        },
      },
    }),
  ]);
  // An act on one of the actions below is listed there, as one of its steps.
  const onAction = new Map<string, (typeof janeActs)[number]>();
  for (const a of janeActs)
    if (a.actionId && !onAction.has(a.actionId)) onAction.set(a.actionId, a);
  const recorded: TimelineEntry[] = janeActs
    .filter((a) => !a.actionId)
    .map((a) => ({
      id: `jane:${a.id}`,
      at: a.createdAt,
      sector: a.sector,
      sectorLabel: labelOf(a.sector),
      by: a.authority === "yes" ? "you" : "jane",
      what: a.what,
      why: a.why,
      cents: a.cents > 0 ? a.cents : null,
      undoHref: a.undoHref && a.undoUntil && a.undoUntil > now ? a.undoHref : null,
      simulated: a.simulated,
      steps: [],
      actId: a.id,
      reported: a.mistake !== null,
    }));
  const said = janeActs.map((a) => ({ sector: a.sector, cents: a.cents, at: a.createdAt }));
  const older: TimelineEntry[] = [
    ...acts.map((a): TimelineEntry => ({
      id: `act:${a.id}`,
      at: a.createdAt,
      sector: a.sector,
      sectorLabel: labelOf(a.sector),
      by: "jane",
      what: a.what,
      why: `${labelOf(a.sector)} is on your autopilot, and this was within the limits you set.`,
      cents: a.cents > 0 ? a.cents : null,
      undoHref: null,
      // No real partner has ever been connected: every older act was a stand-in's.
      simulated: true,
      steps: [],
      actId: null,
      reported: false,
    })),
    ...transfers.map((t): TimelineEntry => ({
      id: `transfer:${t.id}`,
      at: t.createdAt,
      sector: t.sector,
      sectorLabel: labelOf(t.sector),
      by: "you",
      what: `Moved ${formatCents(t.amountCents)} to ${t.toName}${
        t.status === "cancelled" ? " (undone)" : ""
      }`,
      why: "You said yes in the chat.",
      cents: t.amountCents,
      undoHref: t.status === "pending" ? "/transfers" : null,
      simulated: true,
      steps: [],
      actId: null,
      reported: false,
    })),
  ];
  const ruleYeses: TimelineEntry[] = [
    ...rules.map((d): TimelineEntry => {
      const title = (d.cardSnapshot as { title?: unknown } | null)?.title;
      return {
        id: `rule:${d.id}`,
        at: d.createdAt,
        sector: "bills",
        sectorLabel: labelOf("bills"),
        by: "jane",
        what: typeof title === "string" ? title : "Said yes for you",
        why: "A standing rule you set said yes to this.",
        cents: null,
        undoHref: null,
        simulated: false,
        steps: [],
        actId: null,
        reported: false,
      };
    }),
    ...actions.map((a): TimelineEntry => ({
      id: `action:${a.id}`,
      at: a.updatedAt,
      sector: ACTION_SECTOR[a.type],
      sectorLabel: labelOf(ACTION_SECTOR[a.type]),
      by: "you",
      what: snapshotTitle(a.decision.cardSnapshot),
      why: actionWhy(a),
      cents: a.refundCents ?? a.confirmedAnnualCents,
      undoHref: null,
      // Actions only run for the demo bank and sample people (src/config/concierge.ts).
      simulated: onAction.get(a.id)?.simulated ?? true,
      steps: stepsOf(a.agentMessages),
      actId: onAction.get(a.id)?.id ?? null,
      reported: Boolean(onAction.get(a.id)?.mistake),
    })),
  ];
  return [...recorded, ...notYetListed(older, said), ...ruleYeses]
    .sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id))
    .slice(0, limit);
}
