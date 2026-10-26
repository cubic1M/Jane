import { createHash } from "node:crypto";
import {
  DEMO_ASSISTANCE_TENTHS,
  DEMO_GRANT_TENTHS,
  MEDICAL_ANSWER_DAYS,
  MEDICAL_LEFT_OUT,
  MEDICAL_LOOKBACK_DAYS,
  MEDICAL_MIN_BILL_CENTS,
  MEDICAL_PARTNER,
} from "@/config/medical-bills";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { listPolicies } from "@/lib/insurance/policies";
import { formatCents, parseMoneyToCents } from "@/lib/money";
import {
  medicalItems,
  planTerms,
  type MedicalBillInput,
  type MedicalItem,
} from "@/planning/medical-bills";
import { DAY_MS, isoDay } from "@/lib/dates";

// Medical bills (spec step 180). Bills found from the person's payments to medical
// providers, plus ones they type in; each checked against their health insurance and
// prepared with an itemized-bill request, an insurance check, a financial assistance
// application and a payment plan at no interest, all written out and sent only on a tap,
// through a provider stand-in that answers after a couple of days. Demo-bank people only.

type Options = { client?: PrismaClient; now?: Date };

export class MedicalBillError extends Error {}

export type MedicalSent = {
  id: string;
  kind: string;
  provider: string;
  amountCents: number;
  status: string;
  sentOn: string;
  resolvedOn: string | null;
  outcome: string | null;
  savedCents: number;
};

export type MedicalBill = MedicalBillInput & {
  source: "payment" | "typed";
  items: (MedicalItem & { sent: MedicalSent | null })[];
};

export type MedicalBills = {
  available: boolean;
  asOf: string;
  hasInsurance: boolean;
  bills: MedicalBill[];
  requests: MedicalSent[];
};

const view = (r: {
  id: string;
  kind: string;
  provider: string;
  amountCents: number;
  status: string;
  sentAt: Date;
  resolvedAt: Date | null;
  outcome: string | null;
  savedCents: number;
}): MedicalSent => ({
  id: r.id,
  kind: r.kind,
  provider: r.provider,
  amountCents: r.amountCents,
  status: r.status,
  sentOn: isoDay(r.sentAt),
  resolvedOn: r.resolvedAt ? isoDay(r.resolvedAt) : null,
  outcome: r.outcome,
  savedCents: r.savedCents,
});

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();

export async function loadMedicalBills(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<MedicalBills> {
  const asOf = isoDay(now);
  const empty: MedicalBills = {
    available: false,
    asOf,
    hasInsurance: false,
    bills: [],
    requests: [],
  };
  if (!(await adviceMode(userId, { client }))) return empty;
  const db = scopedFor(userId, client);
  const [transactions, typed, rows, policies] = await Promise.all([
    db.transactions.findMany({
      where: {
        date: { gte: new Date(now.getTime() - MEDICAL_LOOKBACK_DAYS * DAY_MS) },
        pfcPrimary: "MEDICAL",
        amountCents: { gte: MEDICAL_MIN_BILL_CENTS },
        pending: false,
      },
      select: {
        id: true,
        date: true,
        amountCents: true,
        description: true,
        merchantName: true,
        pfcDetailed: true,
      },
      orderBy: { date: "desc" },
    }),
    db.medicalBills.findMany({ orderBy: { billedOn: "desc" } }),
    db.medicalRequests.findMany({ orderBy: { sentAt: "desc" } }),
    listPolicies(userId, { client }),
  ]);
  const hasInsurance = policies.some((p) => p.kind === "health" && p.status === "active");
  const inputs: (MedicalBillInput & { source: "payment" | "typed" })[] = [
    ...transactions
      .filter((t) => !MEDICAL_LEFT_OUT.includes(t.pfcDetailed ?? ""))
      .map((t) => ({
        key: `tx:${t.id}`,
        provider: titleCase(t.merchantName ?? t.description),
        amountCents: t.amountCents,
        billedOn: isoDay(t.date),
        source: "payment" as const,
      })),
    ...typed.map((b) => ({
      key: `typed:${b.id}`,
      provider: b.provider,
      amountCents: b.amountCents,
      billedOn: isoDay(b.billedOn),
      source: "typed" as const,
    })),
  ];
  return {
    available: true,
    asOf,
    hasInsurance,
    bills: inputs.map((b) => ({
      ...b,
      items: medicalItems(b, hasInsurance).map((item) => {
        const sent = rows.find((r) => r.key === item.id);
        return { ...item, sent: sent ? view(sent) : null };
      }),
    })),
    requests: rows.map(view),
  };
}

// A bill the person typed in.
export async function addMedicalBill(
  userId: string,
  form: { provider: string; amount: string; billedOn: string },
  { client = defaultClient }: Options = {},
): Promise<void> {
  if (!(await adviceMode(userId, { client }))) {
    throw new MedicalBillError("Medical bill help isn't available for your accounts yet.");
  }
  const provider = form.provider.trim().slice(0, 80);
  if (!provider) throw new MedicalBillError("Who is the bill from?");
  const amountCents = parseMoneyToCents(form.amount);
  if (amountCents === null || amountCents <= 0 || amountCents > 100_000_000) {
    throw new MedicalBillError("Enter the amount on the bill, like 850.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.billedOn) || Number.isNaN(Date.parse(form.billedOn))) {
    throw new MedicalBillError("Pick the date on the bill.");
  }
  await scopedFor(userId, client).medicalBills.create({
    data: { userId, provider, amountCents, billedOn: new Date(`${form.billedOn}T00:00:00Z`) },
  });
  await track(userId, "medical_bill_added");
}

// The person tapped Send on one request. Once for each bill and kind.
export async function sendMedicalItem(
  userId: string,
  itemId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<MedicalItem> {
  const data = await loadMedicalBills(userId, { client, now });
  if (!data.available)
    throw new MedicalBillError("Medical bill help isn't available for your accounts yet.");
  const found = data.bills.flatMap((b) => b.items).find((i) => i.id === itemId);
  if (!found) throw new MedicalBillError("That request isn't part of your bills any more.");
  if (found.sent) throw new MedicalBillError("You've already sent that one.");
  const row = await scopedFor(userId, client).medicalRequests.create({
    data: {
      userId,
      key: found.id,
      kind: found.kind,
      billKey: found.bill.key,
      provider: found.bill.provider,
      amountCents: found.bill.amountCents,
      body: found.body,
      status: "sent",
      partner: MEDICAL_PARTNER,
      sentAt: now,
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "medical_request_sent",
    { type: "medical_request", id: row.id },
    { kind: found.kind, provider: found.bill.provider },
  );
  await track(userId, "medical_request_sent", { kind: found.kind });
  return found;
}

// The provider stand-in's answer: the same each time for a request.
export function standInAnswer(
  requestId: string,
  kind: string,
  amountCents: number,
): { granted: boolean; savedCents: number; text: string } {
  const n = createHash("sha256").update(requestId).digest()[0] % 10;
  const granted = n < DEMO_GRANT_TENTHS;
  if (kind === "itemized") {
    return {
      granted: true,
      savedCents: 0,
      text: "Sent: the itemized bill will arrive within 30 days. Check each charge against your insurer's EOB.",
    };
  }
  if (kind === "insurance") {
    return {
      granted: true,
      savedCents: 0,
      text: "Confirmed: they'll bill your insurer first and send a corrected statement with only what your plan says you owe.",
    };
  }
  if (kind === "assistance") {
    if (!granted)
      return {
        granted: false,
        savedCents: 0,
        text: "Declined: your income is above their assistance limit, but you can ask for a payment plan.",
      };
    const savedCents = Math.round((amountCents * DEMO_ASSISTANCE_TENTHS) / 10);
    return {
      granted: true,
      savedCents,
      text: `Approved: ${formatCents(savedCents)} off the bill, leaving ${formatCents(amountCents - savedCents)}.`,
    };
  }
  const plan = planTerms(amountCents);
  return granted
    ? {
        granted: true,
        savedCents: 0,
        text: `Approved: ${plan.months} payments of ${formatCents(plan.paymentCents)} with no interest.`,
      }
    : {
        granted: false,
        savedCents: 0,
        text: "Declined: they only offer plans of up to six months for a bill this size; ask again for a shorter one.",
      };
}

// Answers requests that have waited MEDICAL_ANSWER_DAYS. Returns how many were answered.
export async function refreshMedicalBills(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  const waiting = await db.medicalRequests.findMany({
    where: {
      status: "sent",
      sentAt: { lte: new Date(now.getTime() - MEDICAL_ANSWER_DAYS * DAY_MS) },
    },
    select: { id: true, kind: true, amountCents: true },
  });
  for (const r of waiting) {
    const answer = standInAnswer(r.id, r.kind, r.amountCents);
    await db.medicalRequests.update({
      where: { id: r.id },
      data: {
        status: answer.granted ? "granted" : "declined",
        resolvedAt: now,
        outcome: answer.text,
        savedCents: answer.savedCents,
      },
    });
  }
  return waiting.length;
}
