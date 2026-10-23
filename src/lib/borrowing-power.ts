import {
  BORROW_CHECK_DAYS,
  BORROW_LABELS,
  BORROW_LOAN_PRODUCT,
  BORROW_MOVE_BPS,
  BORROW_MOVE_SHARE,
  BORROW_PROBE_CENTS,
  BORROW_ROUND_CENTS,
  BORROW_STEP_DOWN,
  BORROW_STEP_TRIES,
  BORROW_TERM_MONTHS,
  CARD_PROBE_CENTS,
} from "@/config/borrowing-power";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadDebts } from "@/lib/debts";
import { formatRate } from "@/insights/loans";
import { formatCents } from "@/lib/money";
import type { LenderPartner, LoanOffer } from "@/lib/lenders/partner";
import { loadProfileInput } from "@/lib/profile";
import { lenderPartnerFor } from "@/lib/refinance";
import { upsertOnce } from "@/lib/unique-race";
import {
  bandOf,
  cardFigure,
  improvements,
  nextBand,
  priced,
  targetAmount,
  type Band,
  type CardFigure,
  type LoanFigure,
  type LoanKind,
} from "@/planning/borrowing-power";
import type { FitPerson } from "@/planning/fit";
import { fitPersonFrom } from "@/planning/fit-person";

// What you could borrow (spec step 250), for one person: a mortgage, a car loan, a personal
// loan and a card, each with the likely amount and rate from the lender partner's soft quotes
// (prequalification never touches the score), the score, income and debts it rests on, and what
// would improve it. Checked by Jane once a month and when the page opens without a check; every
// figure carries the day it was checked. Only soft quotes run here: applying is a separate tap
// (spec step 112) that this never makes. The lender is the stand-in, for demo-bank people only.

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const KINDS: readonly LoanKind[] = ["mortgage", "auto", "personal"];

export type Figure = LoanFigure | CardFigure;

export type BorrowingPower = {
  // A lender partner for this person: without one there is nothing to show.
  available: boolean;
  checkedOn: string | null;
  // The score the figures were priced by, and when it was pulled; null before any pull, when
  // a middling score is assumed (and said).
  score: number | null;
  scoreOn: string | null;
  figures: Figure[];
  // What moved since the check before (an amount up or a rate down), in words.
  changes: string[];
};

const quote = (
  partner: LenderPartner,
  kind: LoanKind,
  amountCents: number,
  band: Band,
  month: string,
) =>
  partner.prequalify({
    product: BORROW_LOAN_PRODUCT[kind],
    amountCents,
    termMonths: BORROW_TERM_MONTHS[kind],
    creditBand: band,
    month,
  });

// One kind of loan: the rate at a probe amount, the amount the payment limit allows at it, then
// that amount priced again (lenders cap amounts, so it steps down until one quotes it).
async function loanFigure(
  partner: LenderPartner,
  person: FitPerson,
  kind: LoanKind,
  month: string,
  replacingCents: number,
): Promise<LoanFigure> {
  const band = bandOf(person.creditScore);
  const probe = await quote(partner, kind, BORROW_PROBE_CENTS[kind], band, month);
  const target = targetAmount(person, kind, probe, replacingCents);
  const limit = target?.limit ?? { paymentCents: 0, binding: "comfort" as const };
  let amount = target?.amountCents ?? 0;
  let offers: LoanOffer[] = [];
  for (let i = 0; i < BORROW_STEP_TRIES && amount > 0; i++) {
    offers = await quote(partner, kind, amount, band, month);
    if (offers.length > 0) break;
    const step = BORROW_ROUND_CENTS[kind];
    amount = Math.floor((amount * BORROW_STEP_DOWN) / step) * step;
  }
  const figure = priced(person, kind, amount, offers, limit, replacingCents);
  const up = nextBand(band);
  const better = up && figure.available ? await quote(partner, kind, amount, up.band, month) : null;
  return { ...figure, improve: improvements(figure, person, better) };
}

// What is asked of the partner: soft quotes for each loan and for card transfers, never apply.
export async function checkBorrowing(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<BorrowingPower | null> {
  const found = await lenderPartnerFor(userId, { client });
  if (!found) return null;
  const db = scopedFor(userId, client);
  const asOf = isoDay(now);
  const month = asOf.slice(0, 7);
  const [input, report, book, last] = await Promise.all([
    loadProfileInput(userId, { client, now }),
    db.creditReports.findFirst({
      orderBy: [{ pulledOn: "desc" }, { createdAt: "desc" }],
      select: { score: true, pulledOn: true },
    }),
    loadDebts(userId, { client, now }),
    db.borrowingChecks.findFirst({ select: { figures: true } }),
  ]);
  const person = fitPersonFrom(input, report?.score ?? null);
  // A new home loan takes the place of the one they have (they'd sell to move).
  const mortgage = book.debts.find((d) => d.kind === "mortgage" && (d.balanceCents ?? 0) > 0);
  const figures: Figure[] = [];
  for (const kind of KINDS) {
    const replacing = kind === "mortgage" ? (mortgage?.paymentCents ?? 0) : 0;
    figures.push(await loanFigure(found.partner, person, kind, month, replacing));
  }
  const band = bandOf(person.creditScore);
  const up = nextBand(band);
  const transfers = await found.partner.balanceTransfers({
    amountCents: CARD_PROBE_CENTS,
    creditBand: band,
    month,
  });
  const nextTransfers = up
    ? await found.partner.balanceTransfers({
        amountCents: CARD_PROBE_CENTS,
        creditBand: up.band,
        month,
      })
    : null;
  figures.push(
    cardFigure(
      person,
      transfers.map((t) => t.goToAprBps),
      nextTransfers?.map((t) => t.goToAprBps) ?? null,
    ),
  );
  const data = {
    checkedOn: new Date(`${asOf}T00:00:00Z`),
    partner: found.key,
    score: report?.score ?? null,
    scoreOn: report?.pulledOn ?? null,
    figures: figures as unknown as Prisma.InputJsonArray,
    previous: (Array.isArray(last?.figures) ? last.figures : []) as Prisma.InputJsonArray,
  };
  await upsertOnce(() =>
    db.borrowingChecks.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    }),
  );
  await track(userId, "borrowing_checked", { products: figures.filter((f) => f.available).length });
  return loadBorrowingPower(userId, { client, now });
}

// Jane's monthly check (src/lib/debt-refresh.ts): asks again once BORROW_CHECK_DAYS have passed.
export async function refreshBorrowing(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const row = await scopedFor(userId, client).borrowingChecks.findFirst({
    select: { checkedOn: true },
  });
  if (row && now.getTime() - row.checkedOn.getTime() < BORROW_CHECK_DAYS * DAY_MS) return false;
  return (await checkBorrowing(userId, { client, now })) !== null;
}

// Before Jane's first monthly run, when the person opens the page or asks: check now.
export async function ensureBorrowingChecked(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const row = await scopedFor(userId, client).borrowingChecks.findFirst({ select: { id: true } });
  if (row) return false;
  return (await checkBorrowing(userId, { client, now })) !== null;
}

// What moved between two checks, in words.
export function changesBetween(before: readonly Figure[], now: readonly Figure[]): string[] {
  const out: string[] = [];
  for (const f of now) {
    const b = before.find((x) => x.product === f.product);
    if (!b || !f.available || !b.available || f.aprBps === null || b.aprBps === null) continue;
    const amountNow = f.product === "card" ? f.limitCents : f.amountCents;
    const amountBefore = b.product === "card" ? b.limitCents : (b as LoanFigure).amountCents;
    const what = BORROW_LABELS[f.product].toLowerCase();
    if (b.aprBps - f.aprBps >= BORROW_MOVE_BPS) {
      out.push(
        `The likely rate on ${what} is down to ${formatRate(f.aprBps)}, from ${formatRate(b.aprBps)}.`,
      );
    } else if (amountBefore > 0 && (amountNow - amountBefore) / amountBefore >= BORROW_MOVE_SHARE) {
      out.push(
        `What you could get on ${what} is up to ${formatCents(amountNow)}, from ${formatCents(amountBefore)}.`,
      );
    }
  }
  return out;
}

export async function loadBorrowingPower(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<BorrowingPower> {
  const [found, row] = await Promise.all([
    lenderPartnerFor(userId, { client }),
    scopedFor(userId, client).borrowingChecks.findFirst({
      select: { checkedOn: true, score: true, scoreOn: true, figures: true, previous: true },
    }),
  ]);
  if (!found) {
    return {
      available: false,
      checkedOn: null,
      score: null,
      scoreOn: null,
      figures: [],
      changes: [],
    };
  }
  const figures = (Array.isArray(row?.figures) ? row.figures : []) as unknown as Figure[];
  const previous = (Array.isArray(row?.previous) ? row.previous : []) as unknown as Figure[];
  return {
    available: true,
    checkedOn: row ? isoDay(row.checkedOn) : null,
    score: row?.score ?? null,
    scoreOn: row?.scoreOn ? isoDay(row.scoreOn) : null,
    figures,
    changes: changesBetween(previous, figures),
  };
}
