import { createHash } from "node:crypto";
import {
  DEMO_GRANT_TENTHS,
  LATE_FEE_LOOKBACK_DAYS,
  TIGHT_ANSWER_DAYS,
  TIGHT_PARTNER,
} from "@/config/tight-money";
import { FORECAST_DAYS } from "@/config/detection";
import { loadDetectionInput } from "@/detection/engine";
import { forecastAccounts, upcomingBills } from "@/detection/forecast";
import { nextPayday } from "@/detection/paydays";
import type { DetectionInput } from "@/detection/types";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DebtBook } from "@/insights/debts";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { debtsOr } from "@/lib/debts";
import {
  firstShortfall,
  payFirst,
  tightItems,
  type OrderedBill,
  type Shortfall,
  type TightDebt,
  type TightItem,
} from "@/planning/tight-money";
import { DAY_MS, isoDay } from "@/lib/dates";

// When money is tight (spec step 177). When the checking forecast dips under its cushion,
// Jane prepares one plan: which bills to pay first (housing, utilities and insurance
// before anything else), and requests to make, each written out and sent only on the
// person's tap, through a lender stand-in that answers after a couple of days. Demo-bank
// people only; a real account gets nothing sent anywhere.

type Options = { client?: PrismaClient; now?: Date; input?: DetectionInput; book?: DebtBook };

export class TightMoneyError extends Error {}

export type SentRequest = {
  id: string;
  itemId: string;
  kind: string;
  target: string;
  status: string;
  sentOn: string;
  resolvedOn: string | null;
  outcome: string | null;
};

export type TightMoney = {
  available: boolean;
  asOf: string;
  shortfall: Shortfall | null;
  // Bills from today to the shortfall or next payday, essentials first.
  billsFirst: OrderedBill[];
  // What Jane would ask for, with whether each is sent already.
  items: (TightItem & { sent: SentRequest | null })[];
  // Every request sent, newest first.
  requests: SentRequest[];
};

const empty = (asOf: string, available = false): TightMoney => ({
  available,
  asOf,
  shortfall: null,
  billsFirst: [],
  items: [],
  requests: [],
});

const view = (r: {
  id: string;
  key: string;
  kind: string;
  targetName: string;
  status: string;
  sentAt: Date;
  resolvedAt: Date | null;
  outcome: string | null;
}): SentRequest => ({
  id: r.id,
  itemId: r.key.slice(0, r.key.lastIndexOf(":")),
  kind: r.kind,
  target: r.targetName,
  status: r.status,
  sentOn: isoDay(r.sentAt),
  resolvedOn: r.resolvedAt ? isoDay(r.resolvedAt) : null,
  outcome: r.outcome,
});

// A shortfall is one for the month it falls in: the request key.
const requestKey = (itemId: string, shortfallOn: string) => `${itemId}:${shortfallOn.slice(0, 7)}`;

export async function loadTightMoney(
  userId: string,
  { client = defaultClient, now = new Date(), input: given, book: givenBook }: Options = {},
): Promise<TightMoney> {
  const asOf = isoDay(now);
  if (!(await adviceMode(userId, { client }))) return empty(asOf);
  const db = scopedFor(userId, client);
  const [book, input, rows, lateFees] = await Promise.all([
    debtsOr(givenBook, userId, { client, now }),
    given ? Promise.resolve(given) : loadDetectionInput(userId, { client, now }),
    db.tightRequests.findMany({ orderBy: { sentAt: "desc" } }),
    db.transactions.findMany({
      where: {
        date: { gte: new Date(now.getTime() - LATE_FEE_LOOKBACK_DAYS * DAY_MS) },
        amountCents: { gt: 0 },
        pfcDetailed: "BANK_FEES_LATE_FEES",
      },
      select: { accountId: true, amountCents: true },
    }),
  ]);
  const requests = rows.map(view);
  const forecast = forecastAccounts(input, FORECAST_DAYS)[0];
  const shortfall = forecast ? firstShortfall(forecast.days) : null;
  if (!shortfall) return { ...empty(asOf, true), requests };
  const payday = nextPayday(input, FORECAST_DAYS);
  // The bills to get through: from today to the shortfall or the next payday, whichever is later.
  const until = payday && payday.date > shortfall.date ? payday.date : shortfall.date;
  const bills = upcomingBills(input, FORECAST_DAYS)
    .filter((b) => b.accountId === forecast.accountId && b.date <= until)
    .map((b) => ({ payee: b.merchant, date: b.date, amountCents: b.amountCents }));
  const debts: TightDebt[] = book.debts.flatMap((d) =>
    d.accountId && ["card", "student", "auto", "loan", "mortgage"].includes(d.kind)
      ? [
          {
            key: d.key,
            name: d.name,
            kind: d.kind as TightDebt["kind"],
            balanceCents: d.balanceCents,
            aprBps: d.aprBps,
            paymentCents: d.paymentCents,
            nextDue: d.nextDue,
          },
        ]
      : [],
  );
  const items = tightItems({
    debts,
    shortfallOn: shortfall.date,
    paydayDay: payday ? Number(payday.date.slice(8, 10)) : null,
    lateFees: lateFees.map((f) => ({ debtKey: `account:${f.accountId}`, cents: f.amountCents })),
  });
  return {
    available: true,
    asOf,
    shortfall,
    billsFirst: payFirst(bills),
    items: items.map((item) => {
      const key = requestKey(item.id, shortfall.date);
      const sent = rows.find((r) => r.key === key);
      return { ...item, sent: sent ? view(sent) : null };
    }),
    requests,
  };
}

// The person tapped Send on one item: the request goes to the lender stand-in. Once.
export async function sendTightItem(
  userId: string,
  itemId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ item: TightItem; next: TightItem | null }> {
  const data = await loadTightMoney(userId, { client, now });
  if (!data.available)
    throw new TightMoneyError("Requests aren't available for your accounts yet.");
  if (!data.shortfall) throw new TightMoneyError("Your forecast doesn't show a shortfall now.");
  const found = data.items.find((i) => i.id === itemId);
  if (!found) throw new TightMoneyError("That request isn't part of your plan any more.");
  if (found.sent) throw new TightMoneyError(`You've already sent that one.`);
  const db = scopedFor(userId, client);
  const row = await db.tightRequests.create({
    data: {
      userId,
      key: requestKey(found.id, data.shortfall.date),
      kind: found.kind,
      targetKey: found.debtKey,
      targetName: found.debtName,
      body: found.body,
      status: "sent",
      partner: TIGHT_PARTNER,
      shortfallOn: new Date(`${data.shortfall.date}T00:00:00Z`),
      sentAt: now,
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "tight_request_sent",
    { type: "tight_request", id: row.id },
    { kind: found.kind, target: found.debtName },
  );
  await track(userId, "tight_request_sent", { kind: found.kind });
  const next = data.items.find((i) => i.id !== found.id && !i.sent) ?? null;
  return { item: found, next };
}

// The lender stand-in's answer: the same each time for a request, mostly yes.
export function standInAnswer(requestId: string, kind: string): { granted: boolean; text: string } {
  const n = createHash("sha256").update(requestId).digest()[0] % 10;
  const granted = n < DEMO_GRANT_TENTHS;
  const text = granted
    ? {
        due_move: "Approved: the due date moves, and the next payment stays the same.",
        hardship: "Approved: a reduced payment for three months, then back to normal.",
        lower_rate: "Approved: the rate comes down by 3 points for the next 12 months.",
        waive_fee: "Approved: the late fee is waived as a one-time courtesy.",
      }[kind]
    : "Declined: they can't change this right now, but you can ask again next month.";
  return { granted, text: text ?? "Answered." };
}

// Answers requests that have waited TIGHT_ANSWER_DAYS. Returns how many were answered.
export async function refreshTightMoney(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  const waiting = await db.tightRequests.findMany({
    where: {
      status: "sent",
      sentAt: { lte: new Date(now.getTime() - TIGHT_ANSWER_DAYS * DAY_MS) },
    },
    select: { id: true, kind: true },
  });
  for (const r of waiting) {
    const answer = standInAnswer(r.id, r.kind);
    await db.tightRequests.update({
      where: { id: r.id },
      data: {
        status: answer.granted ? "granted" : "declined",
        resolvedAt: now,
        outcome: answer.text,
      },
    });
  }
  return waiting.length;
}
