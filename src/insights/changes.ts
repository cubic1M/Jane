import {
  BILL_CHANGE_MAX_PRIOR_SPREAD,
  BILL_CHANGE_MIN_CENTS,
  BILL_CHANGE_MIN_PRIOR_CHARGES,
  BILL_CHANGE_MIN_SHARE,
  BILL_CHANGE_USUAL_CHARGES,
  CHANGE_RECENT_DAYS,
  NEW_FEE_HISTORY_DAYS,
  NEW_SUBSCRIPTION_DAYS,
  PACE_EXCLUDED_CATEGORIES,
  PACE_MIN_DAY,
  PACE_MIN_EXTRA_CENTS,
  PACE_MULTIPLE,
  PACE_USUAL_MONTHS,
  PAYCHECK_LATE_DAYS,
  PAYCHECK_MIN_HISTORY,
  PAYCHECK_SMALLER_SHARE,
  PAYCHECK_USUAL_COUNT,
} from "@/config/changes";
import {
  BANK_FEE_CATEGORIES,
  PRICE_INCREASE_EXCLUDED_CATEGORIES,
  PRICE_INCREASE_EXCLUDED_PRIMARIES,
} from "@/config/detection";
import { byDate, inList } from "@/detection/helpers";
import { paychecksByEmployer } from "@/detection/paydays";
import type { Stream } from "@/detection/streams";
import type { DetectionInput, DetectionTransaction } from "@/detection/types";
import { addDays, average, dayOfMonth, daysBetween, median } from "@/detection/units";
import { formatCents } from "@/lib/money";
import { categoryLabel } from "./labels";
import { kindOf, monthsEnding } from "./spending";
import { dayLabel } from "@/lib/day-label";

// Jane notices changes (spec step 97): what changed in someone's money lately, before they
// notice. Pure: the detection input and its streams in, the changes out, newest first.
// Each change has a stable key, so "That's expected" (src/lib/changes.ts) sticks to it.

export const CHANGE_KINDS = [
  "bill_changed",
  "new_subscription",
  "paycheck_late",
  "paycheck_smaller",
  "new_employer",
  "category_pace",
  "new_fee",
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export type Change = {
  kind: ChangeKind;
  key: string;
  // When it happened (YYYY-MM-DD); for a late paycheck, the day it was due.
  date: string;
  // One or two sentences, with the figures.
  title: string;
  // The new amount: the bill's latest charge, the paycheck, the fee, or spent so far.
  amountCents: number;
  // What it usually is: the steady price, the usual paycheck, or the usual pace by now.
  usualCents: number | null;
  merchant: string | null;
  // Spending categories (pace): the label budgets use, and a usual whole month there.
  category: string | null;
  usualMonthCents: number | null;
  // A bill's stream key, shared by its findings (price rise, reshop, bill negotiation).
  streamKey: string | null;
  // A bill's direction: true when it went up.
  up: boolean | null;
  // The account a fee was charged on (its bank_fees finding is "account:<id>").
  accountId: string | null;
};

const base = {
  usualCents: null,
  merchant: null,
  category: null,
  usualMonthCents: null,
  streamKey: null,
  up: null,
  accountId: null,
} satisfies Partial<Change>;

const recent = (date: string, asOf: string) =>
  date > addDays(asOf, -CHANGE_RECENT_DAYS) && date <= asOf;

const excluded = (s: { pfcPrimary: string | null; pfcDetailed: string | null }) =>
  inList(s.pfcPrimary, PRICE_INCREASE_EXCLUDED_PRIMARIES) ||
  inList(s.pfcDetailed, PRICE_INCREASE_EXCLUDED_CATEGORIES);

const earliest = (input: DetectionInput) =>
  input.transactions.reduce<string | null>((min, t) => (!min || t.date < min ? t.date : min), null);

// A regular bill or subscription whose latest charge moved from a steady price.
export function billChanges(input: DetectionInput, streams: Stream[]): Change[] {
  return streams.flatMap((stream): Change[] => {
    const last = stream.charges.at(-1);
    const prior = stream.charges.slice(0, -1).slice(-BILL_CHANGE_USUAL_CHARGES);
    if (!stream.active || !stream.frequency || !last || excluded(stream)) return [];
    if (prior.length < BILL_CHANGE_MIN_PRIOR_CHARGES || !recent(last.date, input.asOf)) return [];
    const usual = Math.round(average(prior.map((c) => c.amountCents)));
    if (usual <= 0) return [];
    const steady = prior.every(
      (c) => Math.abs(c.amountCents - usual) <= usual * BILL_CHANGE_MAX_PRIOR_SPREAD,
    );
    const moved = last.amountCents - usual;
    if (!steady || Math.abs(moved) < Math.max(usual * BILL_CHANGE_MIN_SHARE, BILL_CHANGE_MIN_CENTS))
      return [];
    const up = moved > 0;
    return [
      {
        ...base,
        kind: "bill_changed",
        key: `bill:${stream.key}:${last.amountCents}`,
        date: last.date,
        title: `${stream.merchant} went ${up ? "up" : "down"} from ${formatCents(usual)} to ${formatCents(last.amountCents)}.`,
        amountCents: last.amountCents,
        usualCents: usual,
        merchant: stream.merchant,
        streamKey: stream.key,
        up,
      },
    ];
  });
}

// A regular charge that started lately, for someone whose history goes back further.
export function newSubscriptions(input: DetectionInput, streams: Stream[]): Change[] {
  const since = addDays(input.asOf, -NEW_SUBSCRIPTION_DAYS);
  const first = earliest(input);
  if (!first || first > since) return [];
  return streams.flatMap((stream): Change[] => {
    const start = stream.charges[0];
    const last = stream.charges.at(-1);
    if (!stream.active || !stream.frequency || !start || !last || excluded(stream)) return [];
    if (stream.charges.length < 2 || start.date <= since) return [];
    return [
      {
        ...base,
        kind: "new_subscription",
        key: `new:${stream.key}`,
        date: start.date,
        title: `${stream.merchant} is a new regular charge: ${formatCents(last.amountCents)}, since ${dayLabel(start.date)}.`,
        amountCents: last.amountCents,
        merchant: stream.merchant,
        streamKey: stream.key,
      },
    ];
  });
}

export type Employer = { key: string; name: string; deposits: DetectionTransaction[] };

// Every employer's paychecks, by step 182's definition (src/detection/paydays.ts), so the
// changes, the lean plan and the paycheck split agree with when the next payday is.
export function employers(input: DetectionInput): Employer[] {
  return paychecksByEmployer(input);
}

// A paycheck that's late, smaller than usual, or from a new employer.
export function paycheckChanges(input: DetectionInput): Change[] {
  const all = employers(input);
  return all.flatMap((employer): Change[] => {
    const { deposits, name } = employer;
    const last = deposits.at(-1)!;
    const out: Change[] = [];

    const others = all.filter((e) => e !== employer);
    const older = others.some(
      (e) => e.deposits.filter((d) => d.date < deposits[0].date).length >= 2,
    );
    if (deposits.length === 1 && recent(last.date, input.asOf) && older) {
      out.push({
        ...base,
        kind: "new_employer",
        key: `employer:${employer.key}`,
        date: last.date,
        title: `A paycheck from a new employer: ${formatCents(-last.amountCents)} from ${name} on ${dayLabel(last.date)}.`,
        amountCents: -last.amountCents,
        merchant: name,
      });
    }
    if (deposits.length < PAYCHECK_MIN_HISTORY) return out;

    const gaps = deposits.slice(1).map((d, i) => daysBetween(deposits[i].date, d.date));
    const due = addDays(last.date, Math.round(median(gaps)));
    const late = addDays(due, PAYCHECK_LATE_DAYS);
    // Real-user QA: only when the account's data runs past the day it was late. A CSV import
    // stops on the day it was exported, so a paycheck after that isn't missing, just not
    // imported yet (a synced bank has the days since).
    const seenUntil = input.transactions
      .filter((t) => t.accountId === last.accountId)
      .reduce((m, t) => (t.date > m ? t.date : m), last.date);
    // Late for a while, not forever: after that it's no longer news.
    if (seenUntil > late && input.asOf > late && input.asOf <= addDays(due, CHANGE_RECENT_DAYS)) {
      out.push({
        ...base,
        kind: "paycheck_late",
        key: `late:${employer.key}:${due}`,
        date: due,
        title: `Your paycheck from ${name} hasn't come in. It usually arrives around ${dayLabel(due)}; the last one was on ${dayLabel(last.date)}.`,
        amountCents: -last.amountCents,
        merchant: name,
      });
    }

    const usual = median(
      deposits
        .slice(0, -1)
        .slice(-PAYCHECK_USUAL_COUNT)
        .map((d) => -d.amountCents),
    );
    const amount = -last.amountCents;
    if (recent(last.date, input.asOf) && amount < usual * (1 - PAYCHECK_SMALLER_SHARE)) {
      out.push({
        ...base,
        kind: "paycheck_smaller",
        key: `smaller:${employer.key}:${last.date}`,
        date: last.date,
        title: `Your paycheck from ${name} was smaller than usual: ${formatCents(amount)} on ${dayLabel(last.date)}, where it's usually ${formatCents(usual)}.`,
        amountCents: amount,
        usualCents: usual,
        merchant: name,
      });
    }
    return out;
  });
}

const daysInMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

// A spending category running well above its usual pace this month.
export function paceChanges(input: DetectionInput): Change[] {
  const months = monthsEnding(input.asOf, PACE_USUAL_MONTHS + 1);
  const month = months.at(-1)!;
  const past = months.slice(0, -1);
  const first = earliest(input);
  // The usual needs whole months behind it.
  if (!first || first > addDays(`${past[0]}-01`, PACE_MIN_DAY)) return [];

  const totals = new Map<string, Map<string, number>>();
  for (const t of input.transactions) {
    if (t.date > input.asOf || kindOf({ ...t, pending: false }) !== "spending") continue;
    const m = t.date.slice(0, 7);
    if (!months.includes(m)) continue;
    const category = categoryLabel(t.pfcPrimary);
    const byMonth = totals.get(category) ?? new Map<string, number>();
    byMonth.set(m, (byMonth.get(m) ?? 0) + t.amountCents);
    totals.set(category, byMonth);
  }

  const day = dayOfMonth(input.asOf);
  return [...totals.keys()].sort().flatMap((category): Change[] => {
    if (PACE_EXCLUDED_CATEGORIES.includes(category)) return [];
    const byMonth = totals.get(category)!;
    const usualMonth = Math.round(average(past.map((m) => Math.max(0, byMonth.get(m) ?? 0))));
    const spent = byMonth.get(month) ?? 0;
    if (usualMonth <= 0) return [];
    const pace = Math.round((usualMonth * day) / daysInMonth(month));
    const early = day < PACE_MIN_DAY && spent <= usualMonth;
    if (early || spent < pace * PACE_MULTIPLE || spent - pace < PACE_MIN_EXTRA_CENTS) return [];
    return [
      {
        ...base,
        kind: "category_pace",
        key: `pace:${category}:${month}`,
        date: input.asOf,
        title: `You've spent ${formatCents(spent)} on ${category} so far this month. By now you'd usually have spent about ${formatCents(pace)}.`,
        amountCents: spent,
        usualCents: pace,
        category,
        usualMonthCents: usualMonth,
      },
    ];
  });
}

const FEE_WORDS: Readonly<Record<string, string>> = {
  BANK_FEES_ATM_FEES: "An ATM fee",
  BANK_FEES_CASH_ADVANCE: "A cash advance fee",
  BANK_FEES_FOREIGN_TRANSACTION_FEES: "A foreign transaction fee",
  BANK_FEES_INSUFFICIENT_FUNDS: "An insufficient funds fee",
  BANK_FEES_LATE_FEES: "A late fee",
  BANK_FEES_OVERDRAFT_FEES: "An overdraft fee",
};

// A fee of a kind and amount not charged in the months before it.
export function newFees(input: DetectionInput): Change[] {
  const fees = input.transactions
    .filter((t) => t.amountCents > 0 && inList(t.pfcDetailed, BANK_FEE_CATEGORIES))
    .sort(byDate);
  return fees.flatMap((fee): Change[] => {
    if (!recent(fee.date, input.asOf)) return [];
    const from = addDays(fee.date, -NEW_FEE_HISTORY_DAYS);
    const seenBefore = fees.some(
      (t) =>
        t.id !== fee.id &&
        t.pfcDetailed === fee.pfcDetailed &&
        t.amountCents === fee.amountCents &&
        t.date >= from &&
        (t.date < fee.date || (t.date === fee.date && t.id < fee.id)),
    );
    if (seenBefore) return [];
    const account = input.accounts.find((a) => a.id === fee.accountId)?.name ?? "your account";
    const what = FEE_WORDS[fee.pfcDetailed ?? ""] ?? "A fee";
    return [
      {
        ...base,
        kind: "new_fee",
        key: `fee:${fee.id}`,
        date: fee.date,
        title: `${what} of ${formatCents(fee.amountCents)} on ${account}, on ${dayLabel(fee.date)}.`,
        amountCents: fee.amountCents,
        accountId: fee.accountId,
      },
    ];
  });
}

export function detectChanges(input: DetectionInput, streams: Stream[]): Change[] {
  return [
    ...billChanges(input, streams),
    ...newSubscriptions(input, streams),
    ...paycheckChanges(input),
    ...paceChanges(input),
    ...newFees(input),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
}
