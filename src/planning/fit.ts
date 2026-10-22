import {
  FIT_ASSUMED_SCORE,
  FIT_COMFORT_SHARE,
  FIT_CREDIT_FLOOR,
  FIT_DTI_CEILING,
  FIT_MAX_OPTIONS,
  FIT_MIN_SAVING_CENTS,
  FIT_NET_TO_GROSS,
  FIT_NO_SCORE_EVIDENCE,
  FIT_OFFER_EVIDENCE,
  FIT_TROUBLE_COMFORT_FACTOR,
  type FitNeed,
} from "@/config/fit";
import type { LoanProduct } from "@/config/debt";
import { formatRate } from "@/insights/loans";
import type { LoanOffer } from "@/lib/lenders/partner";
import { formatCents } from "@/lib/money";
import { levelPaymentCents, totalPaidCents } from "./refinance";

// The fit engine (spec step 274), pure: for one need, the person's credit, income, debts and
// cash, and the lender's offers, it works out each option's eligibility, its total cost over
// the whole term with fees (not just the rate), the payment as a share of take-home and
// against a comfortable share, and when the fees pay back; then picks two to four options and
// Jane's pick with a confidence. The chat, the pages, Claude's tools and the detector all read
// this, so they never disagree. Recommendations are demo advice; the caller decides whether to
// show the pick.

export type FitPerson = {
  // Null until a score is pulled; the engine assumes a middling one and says so.
  creditScore: number | null;
  // Take-home pay a month; null when no income is seen.
  incomeCents: number | null;
  // All debt payments a month before this loan.
  debtPaymentsCents: number;
  cashCents: number;
  debtTrouble: boolean;
};

// What the person pays now on what the new loan replaces (a refinance, a consolidation).
export type FitBaseline = {
  label: string;
  balanceCents: number;
  aprBps: number;
  monthlyCents: number;
  remainingMonths: number;
};

export type FitInput = {
  need: FitNeed;
  product: LoanProduct;
  amountCents: number;
  person: FitPerson;
  offers: readonly LoanOffer[];
  baseline?: FitBaseline | null;
  // Evidence behind the person's own facts (income seen, balances seen), as percentages with
  // their reasons; the pick is never surer than the least sure of these and the offers.
  evidence?: readonly { percent: number; reason: string }[];
};

export type FitLabel = "best_cost" | "lowest_payment" | "fastest" | "alternative" | "keep";

export const FIT_LABEL_TEXT: Readonly<Record<FitLabel, string>> = {
  best_cost: "Best total cost",
  lowest_payment: "Lowest payment",
  fastest: "Paid off soonest",
  alternative: "Another lender",
  keep: "Keep what you have",
};

export type FitOption = {
  id: string;
  label: FitLabel;
  lender: string;
  aprBps: number;
  rateType: "fixed" | "variable" | null;
  termMonths: number;
  paymentCents: number;
  feeCents: number;
  // Everything paid over the term, the fee in.
  totalCostCents: number;
  // Against keeping what they have, over each one's own term; null with nothing to compare.
  savesCents: number | null;
  paymentChangeCents: number | null;
  // The new payment as a share of take-home; null without income.
  paymentShare: number | null;
  // Months of the lower payment it takes to earn the fee back; null with no fee or no saving.
  breakEvenMonths: number | null;
  comfortable: boolean;
  headline: string;
  details: string[];
};

export type FitIneligible = { lender: string; aprBps: number; termMonths: number; reason: string };

export type FitResult = {
  need: FitNeed;
  amountCents: number;
  options: FitOption[];
  // The id of Jane's pick, or null when nothing fits.
  pick: string | null;
  confidence: { percent: number; reason: string } | null;
  ineligible: FitIneligible[];
  // Why nothing fits and what would change that; empty when something does.
  whatWouldHelp: string[];
  // Stated assumptions, for "More details".
  assumptions: string[];
};

const pct = (share: number) => `${Math.round(share * 100)}%`;
const years = (months: number) => {
  const y = months / 12;
  return `${Number.isInteger(y) ? y : y.toFixed(1)} yr${y === 1 ? "" : "s"}`;
};

type Scored = Omit<FitOption, "label" | "headline" | "details"> & {
  eligible: boolean;
  why: string | null;
  offer: LoanOffer;
};

function score(input: FitInput, offer: LoanOffer): Scored {
  const { person, product, baseline } = input;
  const paymentCents = levelPaymentCents(input.amountCents, offer.aprBps, offer.termMonths);
  const totalCostCents =
    totalPaidCents(input.amountCents, offer.aprBps, offer.termMonths) + offer.feeCents;
  const baselineTotal = baseline
    ? totalPaidCents(baseline.balanceCents, baseline.aprBps, baseline.remainingMonths)
    : null;
  const savesCents = baselineTotal !== null ? baselineTotal - totalCostCents : null;
  const paymentChangeCents = baseline ? paymentCents - baseline.monthlyCents : null;
  const paymentShare =
    person.incomeCents && person.incomeCents > 0 ? paymentCents / person.incomeCents : null;
  const comfortShare =
    FIT_COMFORT_SHARE[product] * (person.debtTrouble ? FIT_TROUBLE_COMFORT_FACTOR : 1);
  const lowerBy = baseline ? baseline.monthlyCents - paymentCents : 0;
  const breakEvenMonths =
    offer.feeCents > 0 && lowerBy > 0 ? Math.ceil(offer.feeCents / lowerBy) : null;

  // Eligibility: the score and the debt-to-income with the new payment in place of the old.
  const score = person.creditScore ?? FIT_ASSUMED_SCORE;
  const gross = person.incomeCents ? person.incomeCents / FIT_NET_TO_GROSS : null;
  const dtiAfter =
    gross && gross > 0
      ? (person.debtPaymentsCents - (baseline?.monthlyCents ?? 0) + paymentCents) / gross
      : null;
  let why: string | null = null;
  if (score < FIT_CREDIT_FLOOR[product]) {
    why = `Lenders usually want a score of ${FIT_CREDIT_FLOOR[product]} or more for this; yours is ${score}.`;
  } else if (dtiAfter !== null && dtiAfter > FIT_DTI_CEILING[product]) {
    why = `Your debt payments would be ${pct(dtiAfter)} of your income, over the ${pct(FIT_DTI_CEILING[product])} lenders allow.`;
  } else if (!person.incomeCents) {
    why = "I can't see an income to judge the payment against.";
  }
  const comfortable =
    why === null &&
    paymentShare !== null &&
    paymentShare <= comfortShare &&
    // Someone in trouble is never steered to a bigger payment than they have now.
    !(person.debtTrouble && baseline && paymentCents > baseline.monthlyCents);
  return {
    id: offer.id,
    lender: offer.lender,
    aprBps: offer.aprBps,
    rateType: offer.rateType,
    termMonths: offer.termMonths,
    paymentCents,
    feeCents: offer.feeCents,
    totalCostCents,
    savesCents,
    paymentChangeCents,
    paymentShare,
    breakEvenMonths,
    comfortable,
    eligible: why === null,
    why,
    offer,
  };
}

function headlineOf(o: Scored, hasBaseline: boolean): string {
  const rate = `${o.lender} ${formatRate(o.aprBps)}`;
  if (hasBaseline && o.savesCents !== null) {
    return o.savesCents >= 0
      ? `${rate} - ${formatCents(o.savesCents)} less over ${years(o.termMonths)}`
      : `${rate} - ${formatCents(-o.savesCents)} more over ${years(o.termMonths)}`;
  }
  return `${rate} - ${formatCents(o.paymentCents)} a month for ${years(o.termMonths)}`;
}

function detailsOf(o: Scored, baseline: FitBaseline | null | undefined): string[] {
  const lines = [
    `${formatRate(o.aprBps)} ${o.rateType ?? "fixed"} for ${o.termMonths} months`,
    `${formatCents(o.paymentCents)} a month${o.paymentShare !== null ? `, ${pct(o.paymentShare)} of your take-home` : ""}`,
    `${formatCents(o.totalCostCents)} paid in all${o.feeCents > 0 ? `, including ${formatCents(o.feeCents)} in fees` : ", no fees"}`,
  ];
  if (baseline && o.savesCents !== null) {
    lines.push(
      o.savesCents >= 0
        ? `${formatCents(o.savesCents)} less than keeping ${baseline.label} (${formatCents(baseline.monthlyCents)} a month for ${baseline.remainingMonths} more months)`
        : `${formatCents(-o.savesCents)} more than keeping ${baseline.label}`,
    );
  }
  if (o.breakEvenMonths !== null) {
    lines.push(`The fee pays back in ${o.breakEvenMonths} months`);
  }
  return lines;
}

const toOption = (o: Scored, label: FitLabel, input: FitInput): FitOption => ({
  id: o.id,
  label,
  lender: o.lender,
  aprBps: o.aprBps,
  rateType: o.rateType,
  termMonths: o.termMonths,
  paymentCents: o.paymentCents,
  feeCents: o.feeCents,
  totalCostCents: o.totalCostCents,
  savesCents: o.savesCents,
  paymentChangeCents: o.paymentChangeCents,
  paymentShare: o.paymentShare,
  breakEvenMonths: o.breakEvenMonths,
  comfortable: o.comfortable,
  headline: headlineOf(o, Boolean(input.baseline)),
  details: detailsOf(o, input.baseline),
});

export function fit(input: FitInput): FitResult {
  const scored = input.offers.map((o) => score(input, o));
  const eligible = scored.filter((s) => s.eligible);
  const ineligible: FitIneligible[] = scored
    .filter((s) => !s.eligible)
    .map((s) => ({
      lender: s.lender,
      aprBps: s.aprBps,
      termMonths: s.termMonths,
      reason: s.why!,
    }));
  const assumptions = [
    `Eligibility: a score of ${FIT_CREDIT_FLOOR[input.product]} or more and debt payments, the new one included, at most ${pct(FIT_DTI_CEILING[input.product])} of gross income (take-home divided by ${FIT_NET_TO_GROSS}).`,
    `Comfortable: the payment at most ${pct(FIT_COMFORT_SHARE[input.product] * (input.person.debtTrouble ? FIT_TROUBLE_COMFORT_FACTOR : 1))} of your take-home.`,
    "Total cost: every payment over the term plus the fees, not just the rate.",
  ];
  const base: FitResult = {
    need: input.need,
    amountCents: input.amountCents,
    options: [],
    pick: null,
    confidence: null,
    ineligible,
    whatWouldHelp: [],
    assumptions,
  };
  if (eligible.length === 0) {
    const helps: string[] = [];
    const floor = FIT_CREDIT_FLOOR[input.product];
    if ((input.person.creditScore ?? FIT_ASSUMED_SCORE) < floor) {
      helps.push(`A score of ${floor} would open this up; paying cards down is the quickest way.`);
    }
    if (ineligible.some((i) => /debt payments/.test(i.reason))) {
      helps.push(
        "Paying down debt, or a smaller amount, would bring the payments under the limit.",
      );
    }
    return { ...base, whatWouldHelp: helps };
  }

  // The pool the pick comes from: comfortable ones, or if none, the eligible with the lowest
  // payment (a stretch, said so).
  const comfy = eligible.filter((s) => s.comfortable);
  const pool = comfy.length ? comfy : eligible;
  const cheapest = [...pool].sort((a, b) => a.totalCostCents - b.totalCostCents)[0];
  const stretch = comfy.length === 0;
  const best = stretch
    ? [...eligible].sort((a, b) => a.paymentCents - b.paymentCents)[0]
    : cheapest;
  const picked: { s: Scored; label: FitLabel }[] = [{ s: best, label: "best_cost" }];
  const taken = new Set([best.id]);
  const add = (s: Scored | undefined, label: FitLabel) => {
    if (s && !taken.has(s.id) && picked.length < FIT_MAX_OPTIONS) {
      taken.add(s.id);
      picked.push({ s, label });
    }
  };
  add([...eligible].sort((a, b) => a.paymentCents - b.paymentCents)[0], "lowest_payment");
  add(
    [...pool].sort((a, b) => a.termMonths - b.termMonths || a.totalCostCents - b.totalCostCents)[0],
    "fastest",
  );
  add(
    [...eligible]
      .filter((s) => s.lender !== best.lender)
      .sort((a, b) => a.totalCostCents - b.totalCostCents)[0],
    "alternative",
  );
  // Fill to at least two from what's left, cheapest first.
  for (const s of [...eligible].sort((a, b) => a.totalCostCents - b.totalCostCents)) {
    if (picked.length >= 2) break;
    add(s, "alternative");
  }

  const options = picked.map((p) => toOption(p.s, p.label, input));
  // Not worth moving for: keep what you have is the pick, and the best offer stays beside it.
  const keeps =
    input.baseline &&
    (best.savesCents === null || best.savesCents < FIT_MIN_SAVING_CENTS || stretch);
  let pick = best.id;
  if (input.baseline && options.length < FIT_MAX_OPTIONS + 1) {
    const b = input.baseline;
    const keepOption: FitOption = {
      id: "keep",
      label: "keep",
      lender: "Keep what you have",
      aprBps: b.aprBps,
      rateType: null,
      termMonths: b.remainingMonths,
      paymentCents: b.monthlyCents,
      feeCents: 0,
      totalCostCents: totalPaidCents(b.balanceCents, b.aprBps, b.remainingMonths),
      savesCents: 0,
      paymentChangeCents: 0,
      paymentShare:
        input.person.incomeCents && input.person.incomeCents > 0
          ? b.monthlyCents / input.person.incomeCents
          : null,
      breakEvenMonths: null,
      comfortable: true,
      headline: `Keep ${b.label} - ${formatCents(b.monthlyCents)} a month for ${years(b.remainingMonths)} more`,
      details: [
        `${formatRate(b.aprBps)} on ${formatCents(b.balanceCents)}`,
        `${formatCents(b.monthlyCents)} a month for ${b.remainingMonths} more months`,
      ],
    };
    if (keeps) {
      options.splice(Math.min(1, options.length), 0, keepOption);
      pick = "keep";
    } else if (options.length < FIT_MAX_OPTIONS) {
      options.push(keepOption);
    }
  }

  const evidence = [
    {
      ...(input.person.creditScore === null
        ? FIT_NO_SCORE_EVIDENCE
        : { percent: 95, reason: "your credit score" }),
    },
    input.offers.some((o) => o.demo)
      ? FIT_OFFER_EVIDENCE
      : { percent: 90, reason: "the lender's quotes" },
    ...(input.evidence ?? []),
  ];
  const weakest = evidence.reduce((a, b) => (b.percent < a.percent ? b : a));
  return {
    ...base,
    options,
    pick,
    confidence: { percent: weakest.percent, reason: weakest.reason },
    assumptions: stretch
      ? [...assumptions, "None of the options is comfortable, so the pick is the lowest payment."]
      : assumptions,
  };
}
