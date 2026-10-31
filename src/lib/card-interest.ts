import {
  CARD_RATE_PARTNER,
  DEMO_RATE_GRANT_TENTHS,
  PROMO_PACE_MONTHS,
  RATE_ANSWER_DAYS,
  RATE_ASK_CUT_BPS,
  RATE_ASK_MIN_APR_BPS,
  RATE_ASK_MIN_BALANCE_CENTS,
} from "@/config/card-interest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DebtBook } from "@/insights/debts";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addDeadline, markDeadlineDone } from "@/lib/deadlines";
import { debtsOr } from "@/lib/debts";
import { formatCents, parseMoneyToCents } from "@/lib/money";
import { lenderPartnerFor } from "@/lib/refinance";
import { mayAct, recordAct } from "@/lib/sector-autopilot";
import { nextStatementClose } from "@/planning/credit-building";
import {
  interestCents,
  payEarlySaving,
  promoPlan,
  rateAsk,
  rateStep,
  type PromoPlan,
  type RateAsk,
} from "@/planning/card-interest";
import { DAY_MS, isoDay } from "@/lib/dates";
import { formatRate } from "@/lib/percent";
import { rollOf } from "@/lib/hash";

// Less interest on every card (spec step 224). For each card Jane shows what a year of its
// interest costs, what paying earlier saves, when its next statement closes, how any 0%
// promotion the person typed in is pacing (a deferred-interest one that's off pace gets a
// deadline with the monthly amount needed), and a request for a lower rate with a call
// script, sent to the lender stand-in only on a tap. Demo advice, demo-bank people only.

type Options = { client?: PrismaClient; now?: Date; book?: DebtBook };

const monthOf = (now: Date) => isoDay(now).slice(0, 7);

export class CardInterestError extends Error {}

export type RateRequestView = {
  id: string;
  status: string;
  sentOn: string;
  resolvedOn: string | null;
  newAprBps: number | null;
  savingYearlyCents: number;
  outcome: string | null;
};

export type CardView = {
  accountId: string;
  debtKey: string;
  name: string;
  balanceCents: number;
  aprBps: number;
  interestYearCents: number;
  // Paying the usual payment now, not on the due date.
  payEarly: { amountCents: number; days: number; savedCents: number } | null;
  statementClosesOn: string | null;
  rate: (RateAsk & { id: string; sent: RateRequestView | null }) | null;
};

export type PromoView = {
  id: string;
  cardName: string;
  balanceCents: number;
  endsOn: string;
  deferred: boolean;
  goToAprBps: number;
  plan: PromoPlan;
  deadlineRaised: boolean;
  // A balance transfer Jane arranged: ended on the transfer, not removed here.
  fromTransfer: boolean;
};

export type CardInterest = {
  available: boolean;
  asOf: string;
  cards: CardView[];
  promos: PromoView[];
  // Every card's interest for a year, and the yearly saving from rate requests granted.
  interestYearCents: number;
  // Cards whose balance or rate isn't known (a statement file says neither), so their interest
  // isn't in interestYearCents: the year can't be worked out from balances and rates.
  unknownCards: number;
  grantedSavingCents: number;
  requests: (RateRequestView & { cardName: string })[];
};

const view = (r: {
  id: string;
  status: string;
  sentAt: Date;
  resolvedAt: Date | null;
  newAprBps: number | null;
  savingYearlyCents: number;
  outcome: string | null;
}): RateRequestView => ({
  id: r.id,
  status: r.status,
  sentOn: isoDay(r.sentAt),
  resolvedOn: r.resolvedAt ? isoDay(r.resolvedAt) : null,
  newAprBps: r.newAprBps,
  savingYearlyCents: r.savingYearlyCents,
  outcome: r.outcome,
});

export async function loadCardInterest(
  userId: string,
  { client = defaultClient, now = new Date(), book: given }: Options = {},
): Promise<CardInterest> {
  const asOf = isoDay(now);
  const empty: CardInterest = {
    available: false,
    asOf,
    cards: [],
    promos: [],
    interestYearCents: 0,
    unknownCards: 0,
    grantedSavingCents: 0,
    requests: [],
  };
  if (!(await lenderPartnerFor(userId, { client }))) return empty;
  const db = scopedFor(userId, client);
  const since = new Date(now.getTime() - 31 * PROMO_PACE_MONTHS * DAY_MS);
  const [book, liabilities, promoRows, requestRows, payments] = await Promise.all([
    debtsOr(given, userId, { client, now }),
    db.liabilities.findMany({
      select: { accountId: true, lastStatementIssueDate: true, nextPaymentDueDate: true },
    }),
    db.cardPromos.findMany({ orderBy: { endsOn: "asc" } }),
    db.cardRateRequests.findMany({ orderBy: { sentAt: "desc" } }),
    db.transactions.findMany({
      where: {
        date: { gte: since },
        pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        amountCents: { lt: 0 },
      },
      select: { amountCents: true },
    }),
  ]);
  const monthlyPaidCents = Math.round(
    payments.reduce((s, t) => s + -t.amountCents, 0) / PROMO_PACE_MONTHS,
  );
  const cards: CardView[] = [];
  let unknownCards = 0;
  for (const d of book.debts) {
    if (
      d.kind === "card" &&
      d.accountId &&
      d.inNetWorth &&
      (d.balanceCents === null || (d.balanceCents > 0 && d.aprBps === null))
    )
      unknownCards += 1;
    if (d.kind !== "card" || !d.accountId || !d.inNetWorth) continue;
    const balanceCents = d.balanceCents ?? 0;
    const aprBps = d.aprBps ?? 0;
    if (balanceCents <= 0 || aprBps <= 0) continue;
    const liability = liabilities.find((l) => l.accountId === d.accountId);
    const dueOn =
      d.nextDue ?? (liability?.nextPaymentDueDate ? isoDay(liability.nextPaymentDueDate) : null);
    const amount = d.paymentCents ?? 0;
    const early =
      dueOn && amount > 0 ? payEarlySaving({ amountCents: amount, aprBps, asOf, dueOn }) : null;
    const key = `account:${d.accountId}:${monthOf(now)}`;
    const sent = requestRows.find((r) => r.key === key);
    const askable = aprBps >= RATE_ASK_MIN_APR_BPS && balanceCents >= RATE_ASK_MIN_BALANCE_CENTS;
    cards.push({
      accountId: d.accountId,
      debtKey: d.key,
      name: d.name,
      balanceCents,
      aprBps,
      interestYearCents: interestCents(balanceCents, aprBps, 365),
      payEarly: early && early.savedCents > 0 ? { amountCents: amount, ...early } : null,
      statementClosesOn: liability?.lastStatementIssueDate
        ? nextStatementClose(isoDay(liability.lastStatementIssueDate), asOf)
        : null,
      rate: askable
        ? {
            ...rateAsk({ cardName: d.name, aprBps, balanceCents, onTimeMonths: null }),
            id: key,
            sent: sent ? view(sent) : null,
          }
        : null,
    });
  }
  return {
    available: true,
    asOf,
    cards,
    promos: promoRows.map((p) => ({
      id: p.id,
      cardName: p.cardName,
      balanceCents: p.balanceCents,
      endsOn: isoDay(p.endsOn),
      deferred: p.deferred,
      goToAprBps: p.goToAprBps,
      deadlineRaised: p.deadlineId !== null,
      fromTransfer: p.balanceTransferId !== null,
      plan: promoPlan({
        balanceCents: p.balanceCents,
        startedOn: isoDay(p.startedOn),
        endsOn: isoDay(p.endsOn),
        goToAprBps: p.goToAprBps,
        deferred: p.deferred,
        monthlyPaidCents,
        asOf,
      }),
    })),
    interestYearCents: cards.reduce((s, c) => s + c.interestYearCents, 0),
    unknownCards,
    grantedSavingCents: requestRows
      .filter((r) => r.status === "granted")
      .reduce((s, r) => s + r.savingYearlyCents, 0),
    requests: requestRows.map((r) => ({ ...view(r), cardName: r.cardName })),
  };
}

export type PromoForm = {
  cardName: string;
  balance: string;
  startedOn: string;
  endsOn: string;
  goToApr: string;
  deferred: boolean;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// A 0% promotion the person typed in. Raises its deadline at once if it's off pace.
export async function addCardPromo(
  userId: string,
  form: PromoForm,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  if (!(await lenderPartnerFor(userId, { client }))) {
    throw new CardInterestError("Promotions aren't tracked for your accounts yet.");
  }
  const cardName = form.cardName.trim().slice(0, 80);
  if (!cardName) throw new CardInterestError("Which card is the promotion on?");
  const balanceCents = parseMoneyToCents(form.balance);
  if (balanceCents === null || balanceCents <= 0) {
    throw new CardInterestError("Enter what's left on the promotion, like 1200.");
  }
  if (!DATE.test(form.startedOn) || !DATE.test(form.endsOn) || form.endsOn <= form.startedOn) {
    throw new CardInterestError("Enter the dates the promotion started and ends.");
  }
  const apr = Number(form.goToApr);
  if (!Number.isFinite(apr) || apr <= 0 || apr > 60) {
    throw new CardInterestError("Enter the rate charged after the promotion, like 26.99.");
  }
  const db = scopedFor(userId, client);
  // The same promotion twice (a transfer Jane arranged, typed in again) is one record.
  const same = await db.cardPromos.findFirst({
    where: {
      cardName: { equals: cardName, mode: "insensitive" },
      endsOn: new Date(`${form.endsOn}T00:00:00Z`),
    },
    select: { balanceTransferId: true },
  });
  if (same) {
    throw new CardInterestError(
      same.balanceTransferId
        ? "That's the balance transfer you started: it's already on your list."
        : "That promotion is already on your list.",
    );
  }
  await db.cardPromos.create({
    data: {
      userId,
      cardName,
      balanceCents,
      startedOn: new Date(`${form.startedOn}T00:00:00Z`),
      endsOn: new Date(`${form.endsOn}T00:00:00Z`),
      goToAprBps: Math.round(apr * 100),
      deferred: form.deferred,
    },
  });
  await track(userId, "card_promo_added", { deferred: form.deferred });
  await refreshCardInterest(userId, { client, now });
}

export async function removeCardPromo(
  userId: string,
  promoId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const promo = await db.cardPromos.findFirst({
    where: { id: promoId },
    select: { deadlineId: true, balanceTransferId: true },
  });
  if (!promo) throw new CardInterestError("That promotion isn't on your list.");
  if (promo.balanceTransferId) {
    throw new CardInterestError(
      "That one is your balance transfer: mark it paid off or stopped on the transfer.",
    );
  }
  await db.cardPromos.deleteMany({ where: { id: promoId } });
  if (promo.deadlineId) await markDeadlineDone(userId, promo.deadlineId, { client, now });
}

// The person tapped Send on a card's request for a lower rate. Once for each card a month.
export async function sendRateRequest(
  userId: string,
  requestId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ cardName: string }> {
  const data = await loadCardInterest(userId, { client, now });
  if (!data.available)
    throw new CardInterestError("Rate requests aren't available for your accounts yet.");
  const card = data.cards.find((c) => c.rate?.id === requestId);
  if (!card?.rate) throw new CardInterestError("That card isn't part of your list any more.");
  if (card.rate.sent) throw new CardInterestError("You've already asked for this card this month.");
  const row = await scopedFor(userId, client).cardRateRequests.create({
    data: {
      userId,
      key: card.rate.id,
      debtKey: card.debtKey,
      cardName: card.name,
      oldAprBps: card.aprBps,
      body: card.rate.body,
      status: "sent",
      partner: CARD_RATE_PARTNER,
      sentAt: now,
      savingYearlyCents: card.rate.savingYearlyCents,
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "card_rate_requested",
    { type: "card_rate_request", id: row.id },
    { card: card.name, from_bps: card.aprBps },
  );
  await track(userId, "card_rate_requested");
  return { cardName: card.name };
}

// Jane's own lower-rate request: only at Handle everything within the debt caps (it's free and
// not a credit application), and at most one in RATE_REQUEST_EVERY_DAYS whichever review
// sends it. Returns the card it asked, or null.
export async function askNextRateHerself(
  userId: string,
  { client = defaultClient, now = new Date(), book }: Options = {},
): Promise<string | null> {
  const may = await mayAct(userId, "debt", { needs: "all", cents: 0 }, { client, now });
  if (!may.ok) return null;
  const step = rateStep(await loadCardInterest(userId, { client, now, book }), isoDay(now));
  if (step?.kind !== "next") return null;
  await sendRateRequest(userId, step.requestId, { client, now });
  await recordAct(userId, "debt", 0, `Asked ${step.name} for a lower rate`, { client, now });
  return step.name;
}

// The lender stand-in's answer: the same each time for a request.
export function standInRateAnswer(
  requestId: string,
  oldAprBps: number,
  savingYearlyCents: number,
): { granted: boolean; newAprBps: number | null; text: string } {
  const n = rollOf(requestId);
  if (n >= DEMO_RATE_GRANT_TENTHS) {
    return {
      granted: false,
      newAprBps: null,
      text: "Declined: they can't lower it now; ask again in three months.",
    };
  }
  const newAprBps = Math.max(0, oldAprBps - RATE_ASK_CUT_BPS);
  return {
    granted: true,
    newAprBps,
    text: `Approved: the rate goes from ${formatRate(oldAprBps)} to ${formatRate(newAprBps)}, about ${formatCents(savingYearlyCents)} a year.`,
  };
}

// Jane's own step: answers requests that waited, and puts a deadline on every promotion that
// is off pace and still has time (deferred interest first: it costs most).
export async function refreshCardInterest(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ answered: number; deadlines: number }> {
  const db = scopedFor(userId, client);
  const waiting = await db.cardRateRequests.findMany({
    where: { status: "sent", sentAt: { lte: new Date(now.getTime() - RATE_ANSWER_DAYS * DAY_MS) } },
    select: { id: true, oldAprBps: true, savingYearlyCents: true },
  });
  for (const r of waiting) {
    const answer = standInRateAnswer(r.id, r.oldAprBps, r.savingYearlyCents);
    await db.cardRateRequests.update({
      where: { id: r.id },
      data: {
        status: answer.granted ? "granted" : "declined",
        resolvedAt: now,
        newAprBps: answer.newAprBps,
        outcome: answer.text,
        ...(answer.granted ? {} : { savingYearlyCents: 0 }),
      },
    });
  }
  let deadlines = 0;
  if (await lenderPartnerFor(userId, { client })) {
    const data = await loadCardInterest(userId, { client, now });
    for (const p of data.promos) {
      if (p.deadlineRaised || p.plan.ended || p.plan.onPace) continue;
      const title = `${p.cardName}: clear the 0% balance by ${p.endsOn}`;
      await addDeadline(
        userId,
        {
          title,
          dueOn: p.endsOn,
          kind: "other",
          note: p.deferred
            ? `Pay ${formatCents(p.plan.monthlyNeededCents)} a month. If it isn't cleared, interest from the start at ${formatRate(p.goToAprBps)} is charged: about ${formatCents(p.plan.costIfMissedCents)}.`
            : `Pay ${formatCents(p.plan.monthlyNeededCents)} a month to clear it before the rate goes to ${formatRate(p.goToAprBps)}.`,
        },
        { client, now },
      );
      const deadline = await db.deadlines.findFirst({
        where: { title },
        select: { id: true },
        orderBy: { createdAt: "desc" },
      });
      await db.cardPromos.update({
        where: { id: p.id },
        data: { deadlineId: deadline?.id ?? null },
      });
      deadlines += 1;
    }
  }
  return { answered: waiting.length, deadlines };
}
