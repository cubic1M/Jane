import {
  BORROW_HELP_PAYMENT_CENTS,
  BORROW_LOAN_PRODUCT,
  BORROW_ROUND_CENTS,
  BORROW_TERM_MONTHS,
  CARD_LIMIT_SHARE,
  type BorrowProduct,
} from "@/config/borrowing-power";
import { CREDIT_BANDS } from "@/config/debt";
import {
  FIT_ASSUMED_SCORE,
  FIT_COMFORT_SHARE,
  FIT_CREDIT_FLOOR,
  FIT_DTI_CEILING,
  FIT_NET_TO_GROSS,
  FIT_TROUBLE_COMFORT_FACTOR,
} from "@/config/fit";
import type { LoanOffer } from "@/lib/lenders/partner";
import { formatCents } from "@/lib/money";
import { fit, type FitPerson } from "./fit";
import { creditBandOf } from "./credit";
import { formatRate } from "@/lib/percent";

// What you could borrow (spec step 250). Pure: from the person the fit engine works for (their
// score, take-home pay, debt payments and cash), the most each kind of loan could be with a
// payment that stays inside the fit engine's limits, the likely rate from the lender's soft
// quotes, and what would improve each. The amount is priced again through the fit engine
// (./fit.ts), so the rate and lender here are the ones the loan options card would pick.

export type LoanKind = Exclude<BorrowProduct, "card">;
export type Band = "excellent" | "good" | "fair";

export const bandOf = (score: number | null): Band => creditBandOf(score ?? FIT_ASSUMED_SCORE);

// The next band up and the score it starts at; null at the top.
export function nextBand(band: Band): { band: Band; score: number } | null {
  if (band === "fair") return { band: "good", score: CREDIT_BANDS.good };
  if (band === "good") return { band: "excellent", score: CREDIT_BANDS.excellent };
  return null;
}

// What a level payment borrows at a rate over a term.
export function amountFor(paymentCents: number, aprBps: number, termMonths: number): number {
  if (paymentCents <= 0) return 0;
  const r = aprBps / 10_000 / 12;
  if (r === 0) return paymentCents * termMonths;
  return Math.floor((paymentCents * (1 - (1 + r) ** -termMonths)) / r);
}

export type Limit = {
  // The largest payment that fits, and which limit set it.
  paymentCents: number;
  binding: "dti" | "comfort";
};

// The largest new payment inside the fit engine's limits: debt payments (the new one in, any
// payment it replaces out) at most the lender's share of gross income, and the payment itself
// at most the comfortable share of take-home. Null without an income to judge by.
export function paymentLimit(person: FitPerson, kind: LoanKind, replacingCents = 0): Limit | null {
  if (!person.incomeCents || person.incomeCents <= 0) return null;
  const product = BORROW_LOAN_PRODUCT[kind];
  const gross = person.incomeCents / FIT_NET_TO_GROSS;
  const dtiRoom = Math.floor(
    FIT_DTI_CEILING[product] * gross - (person.debtPaymentsCents - replacingCents),
  );
  const comfort = Math.floor(
    person.incomeCents *
      FIT_COMFORT_SHARE[product] *
      (person.debtTrouble ? FIT_TROUBLE_COMFORT_FACTOR : 1),
  );
  return dtiRoom < comfort
    ? { paymentCents: Math.max(0, dtiRoom), binding: "dti" }
    : { paymentCents: comfort, binding: "comfort" };
}

const best = (offers: readonly LoanOffer[]) =>
  [...offers].sort((a, b) => a.aprBps - b.aprBps || a.feeCents - b.feeCents)[0] ?? null;

// The amount to ask the lender about: the payment that fits at the lowest rate it quoted.
export function targetAmount(
  person: FitPerson,
  kind: LoanKind,
  probe: readonly LoanOffer[],
  replacingCents = 0,
): { amountCents: number; limit: Limit } | null {
  const limit = paymentLimit(person, kind, replacingCents);
  const low = best(probe);
  if (!limit || !low) return null;
  const step = BORROW_ROUND_CENTS[kind];
  const amountCents =
    Math.floor(amountFor(limit.paymentCents, low.aprBps, low.termMonths) / step) * step;
  return { amountCents, limit };
}

export type LoanFigure = {
  product: LoanKind;
  available: boolean;
  // Why not, when it isn't.
  why: string | null;
  amountCents: number;
  aprBps: number | null;
  lender: string | null;
  termMonths: number;
  paymentCents: number;
  feeCents: number;
  binding: Limit["binding"] | null;
  improve: string[];
};

// The amount priced through the fit engine: its pick, or the reason nothing fits.
export function priced(
  person: FitPerson,
  kind: LoanKind,
  amountCents: number,
  offers: readonly LoanOffer[],
  limit: Limit,
  replacingCents = 0,
): LoanFigure {
  const product = BORROW_LOAN_PRODUCT[kind];
  const termMonths = BORROW_TERM_MONTHS[kind];
  const none = (why: string): LoanFigure => ({
    product: kind,
    available: false,
    why,
    amountCents: 0,
    aprBps: null,
    lender: null,
    termMonths,
    paymentCents: 0,
    feeCents: 0,
    binding: null,
    improve: [],
  });
  const score = person.creditScore ?? FIT_ASSUMED_SCORE;
  if (score < FIT_CREDIT_FLOOR[product]) {
    return {
      ...none(
        `Lenders usually want a score of ${FIT_CREDIT_FLOOR[product]} or more; yours is ${score}.`,
      ),
      improve: [
        `A score of ${FIT_CREDIT_FLOOR[product]} would open this up; paying cards down is the quickest way.`,
      ],
    };
  }
  if (amountCents <= 0 || offers.length === 0) {
    return {
      ...none(
        limit.binding === "dti"
          ? "Your debt payments already take as much of your income as lenders allow."
          : "There's no payment that fits your take-home pay yet.",
      ),
      improve: ["Paying down debt, or a higher income, would make room for a payment."],
    };
  }
  const person2 = { ...person, debtPaymentsCents: person.debtPaymentsCents - replacingCents };
  const result = fit({
    need: kind === "mortgage" ? "home" : kind === "auto" ? "car" : "personal",
    product,
    amountCents,
    person: person2,
    offers,
  });
  const pick = result.options.find((o) => o.id === result.pick) ?? null;
  if (!pick) {
    return none(result.ineligible[0]?.reason ?? "None of the offers fits.");
  }
  return {
    product: kind,
    available: true,
    why: null,
    amountCents,
    aprBps: pick.aprBps,
    lender: pick.lender,
    termMonths: pick.termMonths,
    paymentCents: pick.paymentCents,
    feeCents: pick.feeCents,
    binding: limit.binding,
    improve: [],
  };
}

// What would raise the amount or lower the rate: the next credit band (from the lender's quote
// at that band), and, where debt payments set the limit, each $100 a month less in them.
export function improvements(
  figure: LoanFigure,
  person: FitPerson,
  nextBandOffers: readonly LoanOffer[] | null,
): string[] {
  if (!figure.available || figure.aprBps === null) return figure.improve;
  const out: string[] = [];
  const up = nextBand(bandOf(person.creditScore));
  const better = nextBandOffers ? best(nextBandOffers) : null;
  if (up && better && better.aprBps < figure.aprBps) {
    const more =
      amountFor(figure.paymentCents, better.aprBps, figure.termMonths) - figure.amountCents;
    out.push(
      `A score of ${up.score} or more would likely bring the rate to about ${formatRate(better.aprBps)} (from ${formatRate(figure.aprBps)})${more > 0 ? `, so the same payment would borrow about ${formatCents(more)} more` : ""}.`,
    );
  }
  if (figure.binding === "dti") {
    out.push(
      `Your other debt payments set the limit: each ${formatCents(BORROW_HELP_PAYMENT_CENTS)} a month less in them adds about ${formatCents(amountFor(BORROW_HELP_PAYMENT_CENTS, figure.aprBps, figure.termMonths))}.`,
    );
  } else if (figure.binding === "comfort") {
    out.push(
      "The limit is a payment that stays comfortable on your take-home pay; a higher income, or a larger down payment, raises what you can buy.",
    );
  }
  return out;
}

export type CardFigure = {
  product: "card";
  available: boolean;
  why: string | null;
  // A guess from income and band (CARD_LIMIT_SHARE), not the issuer's.
  limitCents: number;
  aprBps: number | null;
  improve: string[];
};

// A card: the likely rate is the lowest the issuers quote for the band once any intro offer
// ends; the limit is a stated guess from gross income.
export function cardFigure(
  person: FitPerson,
  goToAprBps: readonly number[],
  nextBandAprBps: readonly number[] | null,
): CardFigure {
  const band = bandOf(person.creditScore);
  const apr = goToAprBps.length ? Math.min(...goToAprBps) : null;
  if (!person.incomeCents || apr === null) {
    return {
      product: "card",
      available: false,
      why: !person.incomeCents
        ? "I can't see an income to judge a limit by."
        : "No card quotes yet.",
      limitCents: 0,
      aprBps: null,
      improve: [],
    };
  }
  const gross = (person.incomeCents * 12) / FIT_NET_TO_GROSS;
  // Rounded to the nearest $100: it's a guess.
  const limitFor = (b: Band) => Math.round((gross * CARD_LIMIT_SHARE[b]) / 10_000) * 10_000;
  const limitCents = limitFor(band);
  const improve: string[] = [];
  const up = nextBand(band);
  const nextApr = nextBandAprBps?.length ? Math.min(...nextBandAprBps) : null;
  if (up && nextApr !== null && nextApr < apr) {
    improve.push(
      `A score of ${up.score} or more would likely mean about ${formatRate(nextApr)} and a limit nearer ${formatCents(limitFor(up.band))}.`,
    );
  }
  improve.push("Paying the card in full each month means the rate never applies.");
  return { product: "card", available: true, why: null, limitCents, aprBps: apr, improve };
}
