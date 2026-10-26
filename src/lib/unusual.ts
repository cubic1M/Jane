import { CARD_LOCK_STEPS, UNUSUAL_REFUND_MISSING_DAYS } from "@/config/detection";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { UNUSUAL_EXPECTED_FOR_BUSINESS } from "@/config/detection";
import { loadProfile } from "@/lib/profile";
import { keyOf, parseKey, type UnusualAlert } from "@/detection/unusual";
import { addDays } from "@/detection/units";
import { isoDay as isoDate } from "@/lib/dates";

// Unusual activity (spec step 208): what the person has said is theirs (so Jane stays
// quiet about that merchant), the refunds that never arrived, and the two answers on an
// alert. "This was me" teaches the merchant; "not me" opens a dispute card the team works
// from, and gives the steps to lock the card.

type Options = { client?: PrismaClient; now?: Date };

export async function loadTaught(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<Map<string, number>> {
  const rows = await scopedFor(userId, client).unusualAnswers.findMany({
    where: { answer: "me" },
    select: { merchantKey: true, amountCents: true },
  });
  const taught = new Map<string, number>();
  for (const r of rows)
    taught.set(r.merchantKey, Math.max(taught.get(r.merchantKey) ?? 0, r.amountCents));
  return taught;
}

// Detailed categories the person's profile (spec step 253) makes expected, so they're never
// unusual: a small-business owner's payroll, suppliers, rent and tax payments.
export async function expectedFor(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ReadonlySet<string>> {
  const profile = await loadProfile(userId, { client, now });
  return profile.facts.income_pattern.value === "business"
    ? new Set(UNUSUAL_EXPECTED_FOR_BUSINESS)
    : new Set();
}

// A refund the team asked for, done long enough ago that it should have come, and still not
// in the transactions.
export async function missingRefundAlerts(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<UnusualAlert[]> {
  const cutoff = new Date(`${addDays(isoDate(now), -UNUSUAL_REFUND_MISSING_DAYS)}T23:59:59Z`);
  const actions = await scopedFor(userId, client).actions.findMany({
    where: {
      type: "request_refund",
      status: "done",
      refundSeenAt: null,
      refundCents: { gt: 0 },
      completedAt: { lte: cutoff },
    },
    select: { id: true, refundCents: true, decision: { select: { cardSnapshot: true } } },
  });
  return actions.map((a) => {
    const title = (a.decision.cardSnapshot as { title?: string } | null)?.title ?? "a refund";
    return {
      type: "unusual_activity" as const,
      key: keyOf("refund", "refund", a.id),
      title: `${formatCents(a.refundCents ?? 0)} refund hasn't arrived`,
      body: `Our team finished "${title}" more than ${UNUSUAL_REFUND_MISSING_DAYS} days ago, but the money isn't in your transactions yet.`,
    };
  });
}

export class UnusualError extends Error {}

export type UnusualOutcome = { answer: "me" | "not_me"; note: string; steps: readonly string[] };

export async function answerUnusual(
  userId: string,
  alertId: string,
  answer: "me" | "not_me",
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<UnusualOutcome> {
  const db = scopedFor(userId, client);
  const alert = await db.alerts.findFirst({
    where: { id: alertId, type: "unusual_activity" },
    select: { id: true, key: true, title: true, body: true },
  });
  const parsed = alert && parseKey(alert.key);
  if (!alert || !parsed) throw new UnusualError("That alert isn't there anymore.");
  if (await db.unusualAnswers.findFirst({ where: { alertId }, select: { id: true } })) {
    throw new UnusualError("You already answered this one.");
  }
  const amount = Number(/\$([\d,]+\.\d\d)/.exec(alert.title)?.[1]?.replace(/,/g, "") ?? 0) * 100;
  let findingId: string | null = null;
  if (answer === "not_me") {
    const finding = await db.findings.create({
      data: {
        userId,
        type: "duplicate_charge",
        key: `unusual:${alert.id}`,
        title: `Dispute: ${alert.title}`,
        annualSavingsCents: Math.round(amount),
        amountCents: Math.round(amount),
        confidence: "high",
        evidence: { unusual: true, alertKey: alert.key, detail: alert.body },
        status: "new",
      },
      select: { id: true },
    });
    findingId = finding.id;
  }
  await db.unusualAnswers.create({
    data: {
      userId,
      alertId,
      merchantKey: parsed.merchantKey,
      rule: parsed.rule,
      answer,
      amountCents: Math.round(amount),
      findingId,
      createdAt: now,
    },
  });
  await db.alerts.updateMany({ where: { id: alertId, readAt: null }, data: { readAt: now } });
  await logAudit(
    { type: "user", id: userId },
    "unusual_answered",
    { type: "alert", id: alertId },
    { answer, rule: parsed.rule },
  );
  await track(userId, "unusual_answered", { answer, rule: parsed.rule });
  return answer === "me"
    ? {
        answer,
        note: "Thanks. I won't flag that merchant again unless it's much more than this.",
        steps: [],
      }
    : {
        answer,
        note: "I've opened a dispute card on your plan: say yes there and our team asks the card for the money back. Meanwhile, lock the card.",
        steps: CARD_LOCK_STEPS,
      };
}
