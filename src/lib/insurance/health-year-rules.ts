import {
  BIG_BILL_MIN_CENTS,
  DISPUTE_TOLERANCE_CENTS,
  FSA_DEADLINE,
  FSA_WARN_DAYS,
  FSA_WARN_MIN_CENTS,
  HEALTH_PLAN_EXCLUDED_CATEGORIES,
} from "@/config/insurance";
import { formatCents } from "@/lib/money";

// Health cover all year (spec step 200): where the person is in their plan's year, from the
// plan's terms and their medical spending. Facts only, no advice. Pure.

export type Plan = {
  label: string;
  deductibleCents: number;
  outOfPocketMaxCents: number | null;
  // The person's share after the deductible, in percent.
  coinsurance: number;
};

export type Bill = {
  id: string;
  date: string;
  provider: string;
  cents: number;
  // Plaid's detailed category, to leave out what a dental or vision plan pays.
  category: string | null;
};

// Bills a health plan counts: medical spending outside the dental and vision categories.
export const planBills = (bills: Bill[]) =>
  bills
    .filter((b) => !b.category || !HEALTH_PLAN_EXCLUDED_CATEGORIES.includes(b.category))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

// What the person pays of one bill given what they've already paid toward the deductible
// and out-of-pocket maximum this year.
export function personShare(
  plan: Plan,
  billCents: number,
  before: { deductiblePaidCents: number; oopPaidCents: number },
): number {
  const deductibleLeft = Math.max(0, plan.deductibleCents - before.deductiblePaidCents);
  const inDeductible = Math.min(billCents, deductibleLeft);
  const share = inDeductible + Math.round(((billCents - inDeductible) * plan.coinsurance) / 100);
  const oopLeft =
    plan.outOfPocketMaxCents === null
      ? Infinity
      : Math.max(0, plan.outOfPocketMaxCents - before.oopPaidCents);
  return Math.min(share, oopLeft);
}

export type Progress = {
  spendCents: number;
  deductibleMetCents: number;
  deductibleLeftCents: number;
  // What the plan says the person has owed so far (deductible plus coinsurance, to the maximum).
  oopSoFarCents: number;
  oopLeftCents: number | null;
  // The month (1–12) the maximum is reached at this year's pace, "reached" if already, or null
  // when it isn't on pace to be.
  maxMonth: number | "reached" | null;
};

export function progress(plan: Plan, bills: Bill[], asOf: string): Progress {
  const spend = bills.reduce((n, b) => n + b.cents, 0);
  let deductiblePaid = 0;
  let oop = 0;
  for (const b of bills) {
    const share = personShare(plan, b.cents, {
      deductiblePaidCents: deductiblePaid,
      oopPaidCents: oop,
    });
    deductiblePaid = Math.min(plan.deductibleCents, deductiblePaid + b.cents);
    oop += share;
  }
  const max = plan.outOfPocketMaxCents;
  let maxMonth: Progress["maxMonth"] = null;
  if (max !== null) {
    if (oop >= max) maxMonth = "reached";
    else if (spend > 0 && plan.coinsurance > 0) {
      // The spending at which the person's share reaches the maximum.
      const needed = plan.deductibleCents + ((max - plan.deductibleCents) * 100) / plan.coinsurance;
      const elapsed = Number(asOf.slice(5, 7)) - 1 + Number(asOf.slice(8, 10)) / 31;
      const perMonth = spend / Math.max(elapsed, 1);
      const month = Math.ceil(needed / perMonth);
      maxMonth = month <= 12 ? Math.max(month, Number(asOf.slice(5, 7))) : null;
    }
  }
  return {
    spendCents: spend,
    deductibleMetCents: deductiblePaid,
    deductibleLeftCents: plan.deductibleCents - deductiblePaid,
    oopSoFarCents: oop,
    oopLeftCents: max === null ? null : Math.max(0, max - oop),
    maxMonth,
  };
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export type FsaStatus = {
  electionCents: number;
  usedCents: number;
  leftCents: number;
  deadline: string;
  daysLeft: number;
  // Close enough to the deadline, with enough left, to say so.
  warn: boolean;
};

// An FSA election less the year's eligible spending; the use-it-or-lose-it date is the plan
// year's end.
export function fsaStatus(electionCents: number, spendCents: number, asOf: string): FsaStatus {
  const year = Number(asOf.slice(0, 4));
  const deadline = `${year}-${String(FSA_DEADLINE.month).padStart(2, "0")}-${String(FSA_DEADLINE.day).padStart(2, "0")}`;
  const used = Math.min(electionCents, spendCents);
  const left = electionCents - used;
  const daysLeft = Math.round(
    (Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000,
  );
  return {
    electionCents,
    usedCents: used,
    leftCents: left,
    deadline,
    daysLeft,
    warn: daysLeft >= 0 && daysLeft <= FSA_WARN_DAYS && left >= FSA_WARN_MIN_CENTS,
  };
}

export type Network = "in" | "out" | "unknown";

// Whether a provider is in the plan's network, by the stand-in directory.
export function networkOf(
  provider: string,
  directory: readonly { match: RegExp; inNetwork: boolean }[],
): Network {
  const hit = directory.find((d) => d.match.test(provider));
  return hit ? (hit.inNetwork ? "in" : "out") : "unknown";
}

export type Dispute = {
  bill: Bill;
  // What the plan says the person should have paid, and what they paid.
  shouldPayCents: number;
  paidCents: number;
  overCents: number;
};

// Big bills paid for more than the plan's share, in order: an out-of-network provider is
// left out (the plan pays less there on purpose).
export function disputes(
  plan: Plan,
  bills: Bill[],
  networkOfBill: (b: Bill) => Network,
): Dispute[] {
  const found: Dispute[] = [];
  let deductiblePaid = 0;
  let oop = 0;
  for (const b of bills) {
    const share = personShare(plan, b.cents, {
      deductiblePaidCents: deductiblePaid,
      oopPaidCents: oop,
    });
    deductiblePaid = Math.min(plan.deductibleCents, deductiblePaid + b.cents);
    oop += share;
    if (
      b.cents >= BIG_BILL_MIN_CENTS &&
      networkOfBill(b) !== "out" &&
      b.cents - share > DISPUTE_TOLERANCE_CENTS &&
      b.cents > share
    ) {
      // The bill as paid is the person's whole outlay; the plan should have covered the rest.
      found.push({
        bill: b,
        shouldPayCents: share,
        paidCents: b.cents,
        overCents: b.cents - share,
      });
    }
  }
  return found;
}

export const monthWords = (m: Progress["maxMonth"]) =>
  m === null ? null : m === "reached" ? "reached" : MONTH_NAMES[m - 1];

export const money = formatCents;
