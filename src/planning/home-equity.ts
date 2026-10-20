import {
  ESCROW_CUSHION_MONTHS,
  ESCROW_REFUND_MIN_CENTS,
  PMI_ASK_CONDITIONS,
  PMI_ASK_LTV,
  PMI_AUTO_LTV,
  PROJECT_PRODUCTS,
  type ProjectProduct,
} from "@/config/home-equity";
import { formatCents } from "@/lib/money";

// A home's equity, used well (spec step 228). Pure: PMI against the original value, escrow
// against the real bills, and borrowing for a project compared with the total cost of each.

const MAX_MONTHS = 12 * 50;

// The monthly payment that pays a loan off over months at a yearly rate in basis points.
export function monthlyPayment(principalCents: number, aprBps: number, months: number): number {
  if (principalCents <= 0 || months <= 0) return 0;
  const r = aprBps / 10_000 / 12;
  if (r === 0) return Math.ceil(principalCents / months);
  return Math.ceil((principalCents * r) / (1 - Math.pow(1 + r, -months)));
}

// Walks a loan month by month: the month (1-based) its balance first reaches each target,
// and the interest paid to the end. Null when the payment never pays it off.
function walk(balanceCents: number, aprBps: number, paymentCents: number, targets: number[]) {
  const r = aprBps / 10_000 / 12;
  let balance = balanceCents;
  let interest = 0;
  const reached: (number | null)[] = targets.map((t) => (balance <= t ? 0 : null));
  for (let m = 1; m <= MAX_MONTHS; m++) {
    const i = Math.round(balance * r);
    if (paymentCents <= i) return null;
    interest += i;
    balance = Math.max(0, balance + i - paymentCents);
    targets.forEach((t, k) => {
      if (reached[k] === null && balance <= t) reached[k] = m;
    });
    if (balance === 0) return { months: m, interestCents: interest, reached };
  }
  return null;
}

export const addMonths = (iso: string, months: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
};

export type PmiTimeline = {
  originalValueCents: number;
  balanceCents: number;
  ltv: number;
  // The balances at which PMI can be asked off and must end.
  askBalanceCents: number;
  autoBalanceCents: number;
  canAskNow: boolean;
  endsNow: boolean;
  // Months from now on the current payment (0: already there); null: can't tell.
  monthsToAsk: number | null;
  monthsToAuto: number | null;
  askOn: string | null;
  autoOn: string | null;
};

export function pmiTimeline(input: {
  originalValueCents: number;
  balanceCents: number;
  aprBps: number | null;
  // Principal and interest a month (the payment without escrow); null when unknown.
  paymentPiCents: number | null;
  today: string;
}): PmiTimeline {
  const askBalanceCents = Math.floor(input.originalValueCents * PMI_ASK_LTV);
  const autoBalanceCents = Math.floor(input.originalValueCents * PMI_AUTO_LTV);
  const ltv = input.balanceCents / input.originalValueCents;
  const w =
    input.aprBps !== null && input.paymentPiCents !== null
      ? walk(input.balanceCents, input.aprBps, input.paymentPiCents, [
          askBalanceCents,
          autoBalanceCents,
        ])
      : null;
  const at = (k: number) => (w ? w.reached[k] : null);
  return {
    originalValueCents: input.originalValueCents,
    balanceCents: input.balanceCents,
    ltv,
    askBalanceCents,
    autoBalanceCents,
    canAskNow: input.balanceCents <= askBalanceCents,
    endsNow: input.balanceCents <= autoBalanceCents,
    monthsToAsk: at(0),
    monthsToAuto: at(1),
    askOn: at(0) === null ? null : addMonths(input.today, at(0)!),
    autoOn: at(1) === null ? null : addMonths(input.today, at(1)!),
  };
}

const pct = (share: number) => `${Math.round(share * 1000) / 10}%`;

// The request Jane drafts for the person to send their servicer, under the 80% rule.
export function pmiOriginalLetter(input: {
  name: string;
  loanName: string;
  balanceCents: number;
  originalValueCents: number;
}): string {
  const ltv = input.balanceCents / input.originalValueCents;
  return [
    "To my mortgage servicer:",
    "",
    `I'm writing to ask you to cancel the private mortgage insurance on my loan (${input.loanName}). My principal balance is ${formatCents(input.balanceCents)}, which is ${pct(ltv)} of the home's original value of ${formatCents(input.originalValueCents)}, so it has reached the 80% mark.`,
    ...PMI_ASK_CONDITIONS.map(
      (c) =>
        `- ${c
          .replace(/^You are/, "I am")
          .replace(/^You /, "I ")
          .replace(/\byour\b/g, "my")}`,
    ),
    "Please tell me what you need to process this, including whether you require an appraisal, and confirm in writing the date PMI is removed from my payment.",
    "",
    "Thank you,",
    input.name || "[Your name]",
  ].join("\n");
}

export type EscrowCheck =
  | { kind: "unknown"; why: "no_bills" | "no_split" }
  | {
      kind: "over" | "short" | "ok";
      billsCents: number;
      collectedYearlyCents: number;
      monthlyEscrowCents: number;
      // What the servicer may hold at most: a year of bills and the cushion.
      allowedBalanceCents: number;
      cushionCents: number;
      // The balance above what's allowed (0 when none), and the yearly gap between what's
      // collected and the bills (negative: collecting less than the bills).
      surplusCents: number;
      gapYearlyCents: number;
      escrowBalanceCents: number | null;
    };

// The escrow in the payment against the tax and insurance bills the person gave. The escrow
// share of the payment is the payment less principal and interest.
export function escrowCheck(input: {
  paymentCents: number | null;
  paymentPiCents: number | null;
  yearlyTaxCents: number | null;
  yearlyInsuranceCents: number | null;
  escrowBalanceCents: number | null;
}): EscrowCheck {
  if (input.yearlyTaxCents === null && input.yearlyInsuranceCents === null) {
    return { kind: "unknown", why: "no_bills" };
  }
  if (input.paymentCents === null || input.paymentPiCents === null) {
    return { kind: "unknown", why: "no_split" };
  }
  const billsCents = (input.yearlyTaxCents ?? 0) + (input.yearlyInsuranceCents ?? 0);
  const monthlyEscrowCents = Math.max(0, input.paymentCents - input.paymentPiCents);
  const collectedYearlyCents = monthlyEscrowCents * 12;
  const cushionCents = Math.round((billsCents / 12) * ESCROW_CUSHION_MONTHS);
  const allowedBalanceCents = billsCents + cushionCents;
  const surplusCents =
    input.escrowBalanceCents !== null
      ? Math.max(0, input.escrowBalanceCents - allowedBalanceCents)
      : 0;
  const gapYearlyCents = collectedYearlyCents - billsCents;
  const overCollected = gapYearlyCents >= ESCROW_REFUND_MIN_CENTS;
  const kind =
    surplusCents >= ESCROW_REFUND_MIN_CENTS || overCollected
      ? "over"
      : gapYearlyCents <= -ESCROW_REFUND_MIN_CENTS
        ? "short"
        : "ok";
  return {
    kind,
    billsCents,
    collectedYearlyCents,
    monthlyEscrowCents,
    allowedBalanceCents,
    cushionCents,
    surplusCents,
    gapYearlyCents,
    escrowBalanceCents: input.escrowBalanceCents,
  };
}

// The refund request, for the person to send their servicer.
export function escrowLetter(input: {
  name: string;
  loanName: string;
  check: Extract<EscrowCheck, { billsCents: number }>;
  yearlyTaxCents: number | null;
  yearlyInsuranceCents: number | null;
}): string {
  const c = input.check;
  return [
    "To my mortgage servicer:",
    "",
    `I'm writing about the escrow account on my loan (${input.loanName}). My property tax and homeowners insurance bills come to ${formatCents(c.billsCents)} a year${
      input.yearlyTaxCents !== null && input.yearlyInsuranceCents !== null
        ? ` (${formatCents(input.yearlyTaxCents)} tax and ${formatCents(input.yearlyInsuranceCents)} insurance)`
        : ""
    }, and my payment collects ${formatCents(c.collectedYearlyCents)} a year for escrow${
      c.escrowBalanceCents !== null ? `, with ${formatCents(c.escrowBalanceCents)} held now` : ""
    }.`,
    c.surplusCents >= ESCROW_REFUND_MIN_CENTS
      ? `That is ${formatCents(c.surplusCents)} above a year of bills plus the two-month cushion the rules allow. Please send an escrow analysis and refund the surplus.`
      : `That is ${formatCents(c.gapYearlyCents)} more than the bills. Please send an escrow analysis, refund any surplus and lower my monthly escrow to match the bills.`,
    "",
    "Thank you,",
    input.name || "[Your name]",
  ].join("\n");
}

export type ProjectOption = {
  product: ProjectProduct;
  label: string;
  available: boolean;
  // Why not, when it isn't.
  why: string | null;
  aprBps: number;
  years: number;
  // What the new payment is (for the cash-out refinance: the whole new mortgage payment).
  monthlyCents: number;
  upfrontCents: number;
  interestCents: number;
  // Interest and fees to borrow the project money, all in: the number to compare.
  totalCostCents: number;
};

// Remaining interest on a loan paid at its current payment; null if it never pays off.
function remainingInterest(balanceCents: number, aprBps: number, paymentCents: number) {
  return walk(balanceCents, aprBps, paymentCents, [])?.interestCents ?? null;
}

export type ProjectInput = {
  projectCents: number;
  years: number;
  homeValueCents: number | null;
  mortgageBalanceCents: number;
  mortgageAprBps: number | null;
  mortgagePiCents: number | null;
};

export function compareProject(input: ProjectInput): ProjectOption[] {
  const { projectCents: P, years } = input;
  const months = years * 12;
  const value = input.homeValueCents;
  const combined = (extra: number) => (value ? (input.mortgageBalanceCents + extra) / value : null);
  const out: ProjectOption[] = [];

  const h = PROJECT_PRODUCTS.heloc;
  const hl = combined(P);
  const hPay = monthlyPayment(P, h.aprBps, months);
  out.push({
    product: "heloc",
    label: h.label,
    available: hl === null || hl <= h.maxCombinedLtv,
    why:
      hl !== null && hl > h.maxCombinedLtv
        ? `It would take your loans past ${pct(h.maxCombinedLtv)} of the home's value.`
        : null,
    aprBps: h.aprBps,
    years,
    monthlyCents: hPay,
    upfrontCents: h.closingCents,
    interestCents: hPay * months - P,
    totalCostCents: hPay * months - P + h.closingCents,
  });

  const c = PROJECT_PRODUCTS.cash_out;
  const cl = combined(P);
  const newLoan = input.mortgageBalanceCents + P;
  const cMonths = c.termYears * 12;
  const cPay = monthlyPayment(newLoan, c.aprBps, cMonths);
  const closing = Math.round(newLoan * c.closingShare);
  const keepInterest =
    input.mortgageAprBps !== null && input.mortgagePiCents !== null
      ? remainingInterest(input.mortgageBalanceCents, input.mortgageAprBps, input.mortgagePiCents)
      : null;
  const newInterest = cPay * cMonths - newLoan;
  out.push({
    product: "cash_out",
    label: c.label,
    available: (cl === null || cl <= c.maxCombinedLtv) && keepInterest !== null,
    why:
      cl !== null && cl > c.maxCombinedLtv
        ? `It would take your loan past ${pct(c.maxCombinedLtv)} of the home's value.`
        : keepInterest === null
          ? "I can't see your mortgage's rate and payment to compare."
          : null,
    aprBps: c.aprBps,
    years: c.termYears,
    monthlyCents: cPay,
    upfrontCents: closing,
    interestCents: newInterest,
    // Against keeping the mortgage you have: the extra interest over both loans' lives plus
    // the closing costs.
    totalCostCents: keepInterest === null ? 0 : newInterest - keepInterest + closing,
  });

  const p = PROJECT_PRODUCTS.personal;
  const pPay = monthlyPayment(P, p.aprBps, months);
  const fee = Math.round(P * p.feeShare);
  out.push({
    product: "personal",
    label: p.label,
    available: P <= p.maxCents,
    why: P > p.maxCents ? `Personal loans top out around ${formatCents(p.maxCents)}.` : null,
    aprBps: p.aprBps,
    years,
    monthlyCents: pPay,
    upfrontCents: fee,
    interestCents: pPay * months - P,
    totalCostCents: pPay * months - P + fee,
  });
  return out;
}

// The cheapest available option.
export const cheapest = (options: readonly ProjectOption[]): ProjectOption | null =>
  options.filter((o) => o.available).sort((a, b) => a.totalCostCents - b.totalCostCents)[0] ?? null;

// Principal and interest a month on the person's mortgage, from how it began (the escrow is
// the rest of the payment). Null when the bank doesn't say how it began.
export function mortgagePi(input: {
  originationPrincipalCents: number | null;
  aprBps: number | null;
  termYears: number;
}): number | null {
  if (input.originationPrincipalCents === null || input.aprBps === null) return null;
  return monthlyPayment(input.originationPrincipalCents, input.aprBps, input.termYears * 12);
}
