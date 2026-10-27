import {
  CREDIT_FIX_ANSWER_DAYS,
  CREDIT_FIX_PARTNER,
  DEMO_REMOVE_TENTHS,
} from "@/config/credit-report-fixes";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { creditPartnerFor, requestFor } from "@/lib/credit";
import type { ReportItem } from "@/lib/credit/partner";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addDeadline, markDeadlineDone } from "@/lib/deadlines";
import { dayLabel } from "@/lib/day-label";
import { fixItems, type FixItem } from "@/planning/credit-report-fixes";
import { DAY_MS, isoDay } from "@/lib/dates";
import { rollOf } from "@/lib/hash";

// Collections and credit report errors (spec step 181). Jane asks the credit partner (the
// stand-in, for the demo bank) what is on the report that may need fixing, drafts the right
// letter for each (a debt validation letter, a bureau dispute), each citing the rule and
// deadline from config, tracks the deadlines on the person's deadlines list, and follows
// up in the chat. A letter is sent only on the person's tap.

type Options = { client?: PrismaClient; now?: Date };

export class CreditFixError extends Error {}

export type SentLetter = {
  id: string;
  kind: string;
  itemName: string;
  status: string;
  sentOn: string;
  deadlineOn: string;
  resolvedOn: string | null;
  removed: boolean;
  outcome: string | null;
};

export type ReportFix = {
  item: ReportItem;
  // Gone from the report because a dispute removed or corrected it.
  fixed: boolean;
  letters: (Omit<FixItem, "answerByIfSentOn"> & {
    answerByIfSentToday: string;
    sent: SentLetter | null;
  })[];
};

export type ReportFixes = {
  available: boolean;
  asOf: string;
  fixes: ReportFix[];
  disputes: SentLetter[];
};

const view = (r: {
  id: string;
  kind: string;
  itemName: string;
  status: string;
  sentAt: Date;
  deadlineOn: Date;
  resolvedAt: Date | null;
  removed: boolean;
  outcome: string | null;
}): SentLetter => ({
  id: r.id,
  kind: r.kind,
  itemName: r.itemName,
  status: r.status,
  sentOn: isoDay(r.sentAt),
  deadlineOn: isoDay(r.deadlineOn),
  resolvedOn: r.resolvedAt ? isoDay(r.resolvedAt) : null,
  removed: r.removed,
  outcome: r.outcome,
});

export async function loadReportFixes(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ReportFixes> {
  const asOf = isoDay(now);
  const found = await creditPartnerFor(userId, { client });
  if (!found) return { available: false, asOf, fixes: [], disputes: [] };
  const db = scopedFor(userId, client);
  const [request, rows, user, first] = await Promise.all([
    requestFor(userId, client, now),
    db.creditDisputes.findMany({ orderBy: { sentAt: "desc" } }),
    client.user.findUnique({ where: { id: userId }, select: { name: true } }),
    db.creditReports.findFirst({ orderBy: { pulledOn: "asc" }, select: { pulledOn: true } }),
  ]);
  const items = await found.partner.reportItems(request, first ? isoDay(first.pulledOn) : asOf);
  return {
    available: true,
    asOf,
    disputes: rows.map(view),
    fixes: items.map((item) => ({
      item,
      fixed: rows.some((r) => r.itemId === item.id && r.removed),
      letters: fixItems(item, user?.name ?? "").map(({ answerByIfSentOn, ...letter }) => {
        const sent = rows.find((r) => r.key === letter.id);
        return {
          ...letter,
          answerByIfSentToday: answerByIfSentOn(asOf),
          sent: sent ? view(sent) : null,
        };
      }),
    })),
  };
}

// The person tapped Send on one letter. Once for each item and kind. Puts the date the rule
// gives for an answer on the deadlines list.
export async function sendReportLetter(
  userId: string,
  letterId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ letter: FixItem["kind"]; item: ReportItem; deadlineOn: string }> {
  const data = await loadReportFixes(userId, { client, now });
  if (!data.available)
    throw new CreditFixError("Fixing your credit report isn't available for your accounts yet.");
  const found = data.fixes.flatMap((f) => f.letters).find((l) => l.id === letterId);
  if (!found) throw new CreditFixError("That letter isn't part of your report any more.");
  if (found.sent) throw new CreditFixError("You've already sent that one.");
  // A validation letter must go within its window.
  if (found.windowEndsOn && found.windowEndsOn < data.asOf) {
    throw new CreditFixError(
      `The ${dayLabel(found.windowEndsOn, { year: true })} deadline to ask for validation has passed; dispute it with the bureaus instead.`,
    );
  }
  const deadlineOn = found.answerByIfSentToday;
  const title = `${found.kind === "validation" ? "Collector's validation due" : "Bureaus' answer due"}: ${found.item.creditor}`;
  await addDeadline(
    userId,
    {
      title,
      dueOn: deadlineOn,
      kind: "other",
      note:
        found.kind === "validation"
          ? "Under the Fair Debt Collection Practices Act, collection must stop until they verify the debt."
          : "Under the Fair Credit Reporting Act, the bureaus must investigate within 30 days.",
    },
    { client, now },
  );
  const deadline = await scopedFor(userId, client).deadlines.findFirst({
    where: { title, dueOn: new Date(`${deadlineOn}T00:00:00Z`) },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  const row = await scopedFor(userId, client).creditDisputes.create({
    data: {
      userId,
      key: found.id,
      kind: found.kind,
      itemId: found.item.id,
      itemKind: found.item.kind,
      itemName: found.item.creditor,
      amountCents: found.item.amountCents,
      body: found.body,
      status: "sent",
      partner: CREDIT_FIX_PARTNER,
      sentAt: now,
      deadlineOn: new Date(`${deadlineOn}T00:00:00Z`),
      deadlineId: deadline?.id ?? null,
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "credit_dispute_sent",
    { type: "credit_dispute", id: row.id },
    { kind: found.kind, item: found.item.creditor },
  );
  await track(userId, "credit_dispute_sent", { kind: found.kind });
  return { letter: found.kind, item: found.item, deadlineOn };
}

// The stand-in's answer: an error is always corrected; a collection is removed for most
// validation requests and bureau disputes, and verified (kept) otherwise.
export function standInAnswer(
  requestId: string,
  kind: string,
  itemKind: string,
): { removed: boolean; text: string } {
  if (itemKind === "error") {
    return {
      removed: true,
      text: "Corrected: the bureaus found the late payment was reported in error and removed it.",
    };
  }
  const n = rollOf(requestId);
  const removed = n < DEMO_REMOVE_TENTHS;
  if (kind === "validation") {
    return removed
      ? {
          removed: true,
          text: "The collector couldn't validate the debt, so it stopped collecting and asked the bureaus to delete it.",
        }
      : {
          removed: false,
          text: "The collector sent proof of the debt. It stays on your report; you can still ask the bureaus to verify it.",
        };
  }
  return removed
    ? { removed: true, text: "Deleted: the bureaus couldn't verify the collection." }
    : {
        removed: false,
        text: "Verified: the bureaus confirmed the collection, so it stays. A payment plan or a pay-for-delete offer is the next option.",
      };
}

// Answers letters that have waited CREDIT_FIX_ANSWER_DAYS. Returns how many were answered.
export async function refreshReportFixes(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  const waiting = await db.creditDisputes.findMany({
    where: {
      status: "sent",
      sentAt: { lte: new Date(now.getTime() - CREDIT_FIX_ANSWER_DAYS * DAY_MS) },
    },
    select: { id: true, kind: true, itemKind: true, deadlineId: true },
  });
  for (const r of waiting) {
    const answer = standInAnswer(r.id, r.kind, r.itemKind);
    await db.creditDisputes.update({
      where: { id: r.id },
      data: { status: "resolved", resolvedAt: now, removed: answer.removed, outcome: answer.text },
    });
    if (r.deadlineId) await markDeadlineDone(userId, r.deadlineId, { client, now });
  }
  return waiting.length;
}
