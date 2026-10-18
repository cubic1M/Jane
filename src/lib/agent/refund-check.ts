import { REFUND_ACTION_TYPES, REFUND_MATCH_MIN_SHARE } from "@/config/agent";
import { normalizeMerchant } from "@/data-sources/merchant";
import type { ActionStatus, PrismaClient } from "@/generated/prisma/client";
import { sendStatusEmail, statusEmail } from "@/lib/action-emails";
import { FINDING_STATUS } from "@/lib/action-status";
import { track } from "@/lib/analytics";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { note } from "./run";

// Confirms refunds from the person's own transactions: after each scan, every open or
// finished refund action looks for the money coming back. A refund seen closes the action
// (if a reply hadn't already) and replaces the card's estimate in "saved so far" with what
// actually came back.

type Credit = {
  id: string;
  date: Date;
  amountCents: number;
  description: string;
  merchantName: string | null;
  accountId: string;
  pfcPrimary: string | null;
};

type RefundAction = {
  type: string;
  createdAt: Date;
  evidence: unknown;
};

const FEE_REFUND =
  /\b(fee|overdraft|od)\b.*\b(refund|reversal|reversed|credit)\b|\b(refund|reversal|courtesy credit)\b.*\bfee\b/i;

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

// Pure: whether a credit is this action's refund coming back.
export function isRefundFor(action: RefundAction, credit: Credit): boolean {
  if (credit.amountCents >= 0 || dayOf(credit.date) < dayOf(action.createdAt)) return false;
  const evidence = (action.evidence ?? {}) as { merchant?: unknown; accountId?: unknown };
  if (action.type === "recover_bank_fees") {
    return (
      credit.accountId === evidence.accountId &&
      (credit.pfcPrimary === "BANK_FEES" || FEE_REFUND.test(credit.description))
    );
  }
  const want =
    typeof evidence.merchant === "string" ? normalizeMerchant(evidence.merchant)?.key : null;
  const got = normalizeMerchant(credit.merchantName ?? credit.description)?.key;
  return Boolean(want && got && (got === want || got.startsWith(`${want} `)));
}

// What was asked for: the refund on the card, or for fees the total charged.
export function expectedCents(cardSnapshot: unknown, evidence: unknown): number | null {
  const card = (cardSnapshot ?? {}) as { annualSavingsCents?: unknown };
  if (typeof card.annualSavingsCents === "number") return card.annualSavingsCents;
  const total = (evidence as { totalCents?: unknown } | null)?.totalCents;
  return typeof total === "number" ? total : null;
}

export async function confirmRefunds(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    notify = sendStatusEmail,
  }: { client?: PrismaClient; now?: Date; notify?: typeof sendStatusEmail } = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  const actions = await db.actions.findMany({
    where: {
      type: { in: [...REFUND_ACTION_TYPES] },
      refundSeenAt: null,
      status: { in: ["queued", "in_progress", "waiting_on_user", "done"] },
    },
    select: {
      id: true,
      type: true,
      status: true,
      createdAt: true,
      startedAt: true,
      agentState: true,
      decision: {
        select: {
          findingId: true,
          cardSnapshot: true,
          finding: { select: { evidence: true } },
        },
      },
      user: { select: { email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (actions.length === 0) return 0;
  const since = actions.reduce((min, a) => (a.createdAt < min ? a.createdAt : min), now);
  const credits = await db.transactions.findMany({
    where: { amountCents: { lt: 0 }, date: { gte: new Date(dayOf(since)) } },
    select: {
      id: true,
      date: true,
      amountCents: true,
      description: true,
      merchantName: true,
      accountId: true,
      pfcPrimary: true,
    },
    orderBy: { date: "asc" },
  });
  // A credit only ever confirms one refund.
  const used = new Set<string>();
  let confirmed = 0;
  for (const action of actions) {
    const expected = expectedCents(action.decision.cardSnapshot, action.decision.finding.evidence);
    if (!expected || expected <= 0) continue;
    const view = {
      type: action.type,
      createdAt: action.createdAt,
      evidence: action.decision.finding.evidence,
    };
    const matches = credits.filter((c) => !used.has(c.id) && isRefundFor(view, c));
    const back = matches.reduce((sum, c) => sum + -c.amountCents, 0);
    if (back < expected * REFUND_MATCH_MIN_SHARE) continue;
    for (const c of matches) used.add(c.id);
    const refundCents = Math.min(back, expected);
    const seenOn = matches[matches.length - 1].date;
    const closing = action.status !== "done";
    const status: ActionStatus = "done";
    await db.actions.updateMany({
      where: { id: action.id },
      data: {
        refundSeenAt: seenOn,
        refundCents,
        ...(closing
          ? {
              status,
              completedAt: now,
              startedAt: action.startedAt ?? now,
              userTodo: null,
              agentNextAt: null,
              ...(action.agentState ? { agentState: "finished" as const } : {}),
            }
          : {}),
      },
    });
    if (closing) {
      await db.findings.updateMany({
        where: { id: action.decision.findingId },
        data: { status: FINDING_STATUS.done },
      });
      const title = String(
        (action.decision.cardSnapshot as { title?: unknown } | null)?.title ?? "Your refund",
      );
      const email = statusEmail("done", title, null);
      if (email && action.user.email) {
        await notify(action.user.email, email).catch((error) =>
          console.error("Refund email failed", { actionId: action.id, error: String(error) }),
        );
      }
    }
    await logAudit(
      SYSTEM_ACTOR,
      "refund_seen",
      { type: "action", id: action.id },
      {
        user_id: userId,
        refund_cents: refundCents,
        closed: closing,
      },
    );
    await note(
      userId,
      action.id,
      `Saw ${formatCents(refundCents)} come back on ${dayOf(seenOn)}${closing ? ": done" : ""}.`,
      client,
    );
    await track(userId, "refund_seen", { action_type: action.type, refund_cents: refundCents });
    confirmed += 1;
  }
  return confirmed;
}
