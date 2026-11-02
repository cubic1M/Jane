import { SECTOR_LABELS, type Sector } from "@/config/autopilot-sectors";
import { RULE_ACT_PREFIX } from "@/config/rules";
import type { ActionStatus, ActionType, PrismaClient } from "@/generated/prisma/client";
import { ACTION_STATUS_LABELS } from "@/lib/action-status";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { doneSaving, snapshotTitle } from "@/lib/hubs/jane";
import { formatCents } from "@/lib/money";

// Everything Jane did (spec step 187): one honest record across sectors. Every action
// Jane takes on its own is written to autopilot_acts (recordAct, src/lib/sector-autopilot.ts)
// when it takes it, so each appears here with its reason; what the person tapped through
// the money-movement partner and yes-answers from standing rules are added, and what followed a
// person's yes on a card (debugger 11-02: "nothing yet" right after a Yes, with money saved).
// Transfers still pending can be undone from /transfers.

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
};

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
  agentMessages: { body: string; summary: string | null; direction: string }[];
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

export async function loadTimeline(
  userId: string,
  { client = defaultClient, limit = 50 }: { client?: PrismaClient; limit?: number } = {},
): Promise<TimelineEntry[]> {
  const db = scopedFor(userId, client);
  const [acts, transfers, rules, actions] = await Promise.all([
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
          take: 1,
          select: { body: true, summary: true, direction: true },
        },
      },
    }),
  ]);
  const entries: TimelineEntry[] = [
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
    })),
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
    })),
  ];
  return entries
    .sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id))
    .slice(0, limit);
}
