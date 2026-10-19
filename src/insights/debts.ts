import { BNPL_PAY_IN_4_RATE_SOURCE } from "@/config/debt";
import { LOAN_DUE_SOON_DAYS } from "@/config/loans";
import { SYNCED_KINDS, syncedKindOf } from "@/data-sources/types";
import type { BnplPlan } from "./bnpl";
import { netWorth } from "./net-worth";

// Every debt in one place (spec step 109): loans and cards from the bank (Plaid
// Liabilities, or the demo bank's Plaid-shaped details), buy now, pay later plans found
// from payments (./bnpl.ts), and the terms the person typed for anything the bank doesn't
// report. Each rate, balance, payment and payoff date says where it came from. The bank
// always wins; typed terms only fill what it leaves out. The loans and cards total is the
// same number net worth counts as owed. Pure.

export type DebtKind = "card" | "mortgage" | "student" | "auto" | "loan" | "bnpl";

// bank: the bank reports it. typed: the person typed it. terms: the plan's own terms (Pay
// in 4 is interest-free). payments: worked out from the payments made so far.
export type DebtSource = "bank" | "typed" | "terms" | "payments";

export type DebtAccountInput = {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentBalanceCents: number | null;
  liability: {
    aprBps: number | null;
    rateType: string | null;
    minimumPaymentCents: number | null;
    nextPaymentDueDate: Date | null;
    payoffDate: Date | null;
    isOverdue: boolean | null;
    pastDueCents: number | null;
    description: string | null;
  } | null;
};

// What the person typed for one debt, by its key.
export type TypedTerms = {
  debtKey: string;
  aprBps: number | null;
  minimumPaymentCents: number | null;
  balanceCents: number | null;
  // YYYY-MM-DD.
  payoffDate: string | null;
  // The day they typed it, YYYY-MM-DD.
  updatedOn: string;
};

export type Debt = {
  // "account:<id>" or "bnpl:<plan key>": what typed terms are saved against.
  key: string;
  accountId: string | null;
  name: string;
  kind: DebtKind;
  kindLabel: string;
  // What's owed now. A card in credit owes nothing.
  balanceCents: number | null;
  balanceFrom: DebtSource | null;
  aprBps: number | null;
  rateType: string | null;
  aprFrom: DebtSource | null;
  // The regular payment and how often: a month, or two weeks for Pay in 4.
  paymentCents: number | null;
  paymentEvery: "month" | "two_weeks";
  paymentFrom: DebtSource | null;
  // YYYY-MM-DD.
  nextDue: string | null;
  dueSoon: boolean;
  payoffDate: string | null;
  payoffFrom: DebtSource | null;
  overdue: boolean;
  pastDueCents: number | null;
  // The bank's own description ("Conventional 30 year fixed"), or the plan's.
  description: string | null;
  // Buy now, pay later plans aren't bank accounts, so net worth doesn't count them.
  inNetWorth: boolean;
  // The day typed terms were last changed, for "You typed it on …".
  typedOn: string | null;
};

export type DebtBook = {
  debts: Debt[];
  // Loans and cards: exactly what net worth counts as owed (src/insights/net-worth.ts).
  accountsOwedCents: number;
  // Buy now, pay later plans with a known balance, added up.
  bnplOwedCents: number;
  // Plans whose balance isn't known yet.
  bnplUnknown: number;
  totalOwedCents: number;
  // Monthly payments added up (Pay in 4 runs every two weeks and ends within weeks, so it's
  // left out), and how many monthly debts have no payment yet.
  monthlyCents: number;
  missingMonthly: number;
  // Debts with money owed but no rate from anywhere: Jane asks for these.
  missingRate: Debt[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (date: Date | null | undefined) => date?.toISOString().slice(0, 10) ?? null;

const KIND_OF: Record<string, DebtKind> = {
  credit_card: "card",
  mortgage: "mortgage",
  student_loan: "student",
  auto_loan: "auto",
  other_loan: "loan",
};

// The first of the values that's there, and where it came from.
function first<T>(...options: [T | null | undefined, DebtSource][]): [T | null, DebtSource | null] {
  for (const [value, from] of options) {
    if (value !== null && value !== undefined) return [value, from];
  }
  return [null, null];
}

const dueSoonOf = (nextDue: string | null, asOf: string) => {
  if (nextDue === null) return false;
  const days = (Date.parse(`${nextDue}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / DAY_MS;
  return days >= 0 && days <= LOAN_DUE_SOON_DAYS;
};

function accountDebt(a: DebtAccountInput, typed: TypedTerms | undefined, asOf: string): Debt {
  const synced = syncedKindOf(a.type, a.subtype);
  const kind = (synced && KIND_OF[synced]) ?? (a.type === "credit" ? "card" : "loan");
  const l = a.liability;
  const [balanceCents, balanceFrom] = first<number>([
    a.currentBalanceCents === null ? null : Math.max(0, a.currentBalanceCents),
    "bank",
  ]);
  const [aprBps, aprFrom] = first<number>([l?.aprBps, "bank"], [typed?.aprBps, "typed"]);
  const [paymentCents, paymentFrom] = first<number>(
    [l?.minimumPaymentCents, "bank"],
    [typed?.minimumPaymentCents, "typed"],
  );
  const [payoffDate, payoffFrom] = first<string>(
    [iso(l?.payoffDate), "bank"],
    [typed?.payoffDate, "typed"],
  );
  const nextDue = iso(l?.nextPaymentDueDate);
  return {
    key: `account:${a.id}`,
    accountId: a.id,
    name: a.mask ? `${a.name} ····${a.mask}` : a.name,
    kind,
    kindLabel: synced ? SYNCED_KINDS[synced].label : (a.subtype ?? a.type),
    balanceCents,
    balanceFrom,
    aprBps,
    rateType: aprFrom === "bank" ? (l?.rateType ?? null) : null,
    aprFrom,
    paymentCents,
    paymentEvery: "month",
    paymentFrom,
    nextDue,
    dueSoon: dueSoonOf(nextDue, asOf),
    payoffDate,
    payoffFrom,
    overdue: l?.isOverdue === true,
    pastDueCents: l?.pastDueCents ?? null,
    // Left out when the name already says it ("Consolidation loan" / "Consolidation").
    description:
      l?.description && !a.name.toLowerCase().includes(l.description.toLowerCase())
        ? l.description
        : null,
    inNetWorth: true,
    typedOn:
      aprFrom === "typed" || paymentFrom === "typed" || payoffFrom === "typed"
        ? (typed?.updatedOn ?? null)
        : null,
  };
}

function planDebt(p: BnplPlan, typed: TypedTerms | undefined, asOf: string): Debt {
  const payIn4 = p.kind === "pay_in_4";
  const [balanceCents, balanceFrom] = first<number>(
    [p.balanceCents, "payments"],
    [typed?.balanceCents, "typed"],
  );
  const [aprBps, aprFrom] = first<number>([payIn4 ? 0 : null, "terms"], [typed?.aprBps, "typed"]);
  const [payoffDate, payoffFrom] = first<string>(
    [p.payoffDate, "payments"],
    [typed?.payoffDate, "typed"],
  );
  return {
    key: `bnpl:${p.key}`,
    accountId: null,
    name: `${p.providerName} ${payIn4 ? "Pay in 4" : "plan"}`,
    kind: "bnpl",
    kindLabel: "Buy now, pay later",
    balanceCents,
    balanceFrom,
    aprBps,
    rateType: null,
    aprFrom,
    paymentCents: p.paymentCents,
    paymentEvery: payIn4 ? "two_weeks" : "month",
    paymentFrom: "payments",
    nextDue: p.nextDate,
    dueSoon: dueSoonOf(p.nextDate, asOf),
    payoffDate,
    payoffFrom,
    overdue: false,
    pastDueCents: null,
    description: payIn4
      ? `${p.paymentsMade} of ${p.paymentsMade + (p.paymentsLeft ?? 0)} payments made`
      : `${p.paymentsMade} ${p.paymentsMade === 1 ? "payment" : "payments"} seen`,
    inNetWorth: false,
    typedOn:
      balanceFrom === "typed" || aprFrom === "typed" || payoffFrom === "typed"
        ? (typed?.updatedOn ?? null)
        : null,
  };
}

export function debtBook(
  input: { accounts: DebtAccountInput[]; plans: BnplPlan[]; typed: TypedTerms[] },
  asOf: string,
): DebtBook {
  const typedBy = new Map(input.typed.map((t) => [t.debtKey, t]));
  const accounts = input.accounts.filter((a) => a.type === "credit" || a.type === "loan");
  const debts = [
    ...accounts.map((a) => accountDebt(a, typedBy.get(`account:${a.id}`), asOf)),
    ...input.plans.map((p) => planDebt(p, typedBy.get(`bnpl:${p.key}`), asOf)),
  ].sort(
    // Overdue first, then by the next due date, then by name.
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999") ||
      a.name.localeCompare(b.name),
  );
  const accountsOwedCents = netWorth(
    accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balanceCents: a.currentBalanceCents,
    })),
  ).debtsCents;
  const plans = debts.filter((d) => d.kind === "bnpl");
  const bnplOwedCents = plans.reduce((sum, d) => sum + (d.balanceCents ?? 0), 0);
  const monthly = debts.filter((d) => d.paymentEvery === "month");
  return {
    debts,
    accountsOwedCents,
    bnplOwedCents,
    bnplUnknown: plans.filter((d) => d.balanceCents === null).length,
    totalOwedCents: accountsOwedCents + bnplOwedCents,
    monthlyCents: monthly.reduce((sum, d) => sum + (d.paymentCents ?? 0), 0),
    missingMonthly: monthly.filter((d) => d.paymentCents === null).length,
    missingRate: debts.filter((d) => d.aprBps === null && (d.balanceCents ?? 1) > 0),
  };
}

// "Your bank reports it", "You typed it on Oct 3, 2026": where a figure came from.
export function sourceLabel(from: DebtSource | null, typedOn: string | null = null): string {
  switch (from) {
    case "bank":
      return "from your bank";
    case "typed":
      return typedOn
        ? `you typed it on ${new Date(`${typedOn}T00:00:00Z`).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          })}`
        : "you typed it";
    case "terms":
      return BNPL_PAY_IN_4_RATE_SOURCE.charAt(0).toLowerCase() + BNPL_PAY_IN_4_RATE_SOURCE.slice(1);
    case "payments":
      return "worked out from your payments";
    default:
      return "not known yet";
  }
}

// Words for each kind, so "my car" finds the car loan and "my house" the mortgage.
const KIND_WORDS: Record<DebtKind, readonly string[]> = {
  card: ["card", "cards", "credit card", "credit"],
  mortgage: ["mortgage", "home", "house", "home loan"],
  student: ["student", "student loan", "student loans", "college", "school"],
  auto: ["car", "auto", "vehicle", "car loan", "truck"],
  loan: ["personal loan", "loan"],
  bnpl: ["buy now pay later", "bnpl", "pay later", "pay in 4", "affirm", "klarna", "afterpay"],
};

// The debt the person means: a word for its kind, or words in its name. Null if none fits.
export function findDebt(debts: readonly Debt[], query: string): Debt | null {
  const q = query
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(?:my|the|our|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return null;
  // Whole words only, so "car" isn't "card".
  const byName = debts.find((d) => new RegExp(`\\b${q}\\b`).test(d.name.toLowerCase()));
  if (byName) return byName;
  // A provider's name first (Klarna), then the kind's words, longest first.
  const kinds = (Object.keys(KIND_WORDS) as DebtKind[])
    .flatMap((kind) => KIND_WORDS[kind].map((word) => ({ kind, word })))
    .sort((a, b) => b.word.length - a.word.length);
  const hit = kinds.find(({ word }) => new RegExp(`\\b${word}\\b`).test(q));
  if (!hit) return null;
  const ofKind = debts.filter((d) => d.kind === hit.kind);
  return (
    ofKind.find((d) => d.name.toLowerCase().includes(hit.word)) ??
    [...ofKind].sort((a, b) => (b.balanceCents ?? 0) - (a.balanceCents ?? 0))[0] ??
    null
  );
}
