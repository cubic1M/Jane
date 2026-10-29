import {
  BANK_FEE_CATEGORIES,
  CHECKUP_MIN_HISTORY_DAYS,
  CHECKUP_MIN_RECURRING_DAYS,
  DUPLICATE_CHARGE_WINDOW_DAYS,
  FORECAST_DAYS,
  IDLE_CASH_MIN_EXCESS_CENTS,
  IDLE_CASH_MONTHS_OF_SPENDING,
  INSURANCE_CATEGORIES,
  LOOKBACK_MONTHS,
  LOW_BALANCE_CUSHION_CENTS,
  PRICE_INCREASE_EXCLUDED_CATEGORIES,
  PRICE_INCREASE_EXCLUDED_PRIMARIES,
  PRICE_INCREASE_MIN_PRIOR_CHARGES,
  PRICE_INCREASE_THRESHOLD,
  REFUND_MAX_AGE_DAYS,
  SERVICE_GROUPS,
  TRIAL_MAX_DAYS,
  TRIAL_MAX_START_CENTS,
  TRIAL_MIN_DAYS,
} from "@/config/detection";
import type { FindingType } from "@/generated/prisma/client";
import { formatCents, formatWholeDollars } from "@/lib/money";
import { cashCushionOf } from "@/planning/idle-cash";
import { detect } from "./detect";
import { forecastAccounts } from "./forecast";
import { inList, inLookback, isProcessorFee } from "./helpers";
import { benchmarkOf } from "./rules/bill-negotiation";
import { isSubscription } from "./rules/subscription-review";
import { buildStreams, type Stream } from "./streams";
import type { Candidate, DetectionInput } from "./types";
import { DAYS_PER_MONTH, MONTHS_PER_YEAR, daysBetween, monthsBefore } from "./units";

// The checkup (the report when little is wrong): every detection rule (./detect.ts) as one line
// with what it found, or the fact that says it found nothing, or "Not enough data yet". It runs
// the rules themselves, so a line never says "passed" where the rule would find something, and
// CHECKS is keyed by finding type, so a new rule without a line fails the type check. Pure.

export type CheckStatus = "found" | "passed" | "not_enough_data";

export type CheckLine = {
  type: FindingType;
  label: string;
  status: CheckStatus;
  // A few words, with the number: "None in 3 months", "2 found".
  line: string;
  // Shown on a tap: what Jane looked at, and the bar it holds.
  detail: string;
};

type Facts = {
  input: DetectionInput;
  streams: Stream[];
  // Days of statements inside the lookback window.
  days: number;
  transactions: number;
};

type Check = {
  label: string;
  // Why the check can't say "passed" yet, or null when it has what it needs.
  missing: (f: Facts) => string | null;
  // Left off the list: nothing for it to look at (no cancellations, no card with cover).
  skip?: (f: Facts) => boolean;
  passed: (f: Facts) => { line: string; detail: string };
};

// "3 months" from 90 days and more; under that, days.
export function spanOf(days: number): string {
  const months = Math.round(days / DAYS_PER_MONTH);
  if (days < 2 * DAYS_PER_MONTH) return days === 1 ? "1 day" : `${days} days`;
  return `${months} months`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const shortHistory = (min: number) => (f: Facts) =>
  f.days < min ? `Jane has ${plural(f.days, "day")} of statements; this check needs ${min}.` : null;

const active = (f: Facts) => f.streams.filter((s) => s.active);
const subscriptions = (f: Facts) => f.streams.filter(isSubscription);
const insurance = (f: Facts) =>
  active(f).filter((s) => inList(s.pfcDetailed, INSURANCE_CATEGORIES));
// The bills the price-rise rule judges: enough charges, and not a kind it leaves out (food,
// shopping and transfers vary by nature).
const priced = (f: Facts) =>
  active(f).filter(
    (s) =>
      s.frequency &&
      s.charges.length > PRICE_INCREASE_MIN_PRIOR_CHARGES &&
      (isSubscription(s) || !inList(s.pfcPrimary, PRICE_INCREASE_EXCLUDED_PRIMARIES)) &&
      !inList(s.pfcDetailed, PRICE_INCREASE_EXCLUDED_CATEGORIES),
  );
const bills = (f: Facts) =>
  active(f).flatMap((s) => {
    const benchmark = benchmarkOf(s);
    return benchmark && s.annualCostCents !== null ? [{ stream: s, benchmark }] : [];
  });
const credit = (f: Facts) => f.input.accounts.filter((a) => a.type === "credit");
const cushion = (f: Facts) =>
  cashCushionOf({
    asOf: f.input.asOf,
    accounts: f.input.accounts.map((a) => ({
      id: a.id,
      type: a.type,
      subtype: a.subtype,
      balanceCents: a.currentBalanceCents,
    })),
    transactions: inLookback(f.input).map((t) => ({
      date: t.date,
      amountCents: t.amountCents,
      accountId: t.accountId,
      pfc: t.pfcDetailed,
    })),
  });
const first =
  <T>(...reasons: ((f: Facts) => T | null)[]) =>
  (f: Facts) =>
    reasons.reduce<T | null>((r, reason) => r ?? reason(f), null);

export const CHECKS: Record<FindingType, Check> = {
  subscription_review: {
    label: "Subscriptions",
    missing: shortHistory(CHECKUP_MIN_RECURRING_DAYS),
    passed: (f) => ({
      line: `None in ${spanOf(f.days)}`,
      detail: `Jane looked for charges that repeat at one price, monthly or yearly, in ${plural(f.transactions, "transaction")}.`,
    }),
  },
  duplicate_subscription: {
    label: "Services that overlap",
    missing: shortHistory(CHECKUP_MIN_RECURRING_DAYS),
    passed: (f) => ({
      line: "No two doing the same job",
      detail: `Jane checked ${plural(subscriptions(f).length, "subscription")} for two of the same kind (${SERVICE_GROUPS.slice(
        0,
        3,
      )
        .map((g) => g.label)
        .join(", ")} and more).`,
    }),
  },
  price_increase: {
    label: "Price rises",
    missing: first(shortHistory(CHECKUP_MIN_RECURRING_DAYS), (f) =>
      priced(f).length === 0
        ? `No recurring bill has charged ${PRICE_INCREASE_MIN_PRIOR_CHARGES + 1} times yet.`
        : null,
    ),
    passed: (f) => ({
      line: `None on ${plural(priced(f).length, "recurring bill")}`,
      detail: `A bill counts as risen when its latest charge is ${Math.round(PRICE_INCREASE_THRESHOLD * 100)}% or more above the ones before.`,
    }),
  },
  bank_fees: {
    label: "Bank fees",
    missing: shortHistory(CHECKUP_MIN_HISTORY_DAYS),
    passed: (f) => {
      const fees = inLookback(f.input).filter(
        (t) => inList(t.pfcDetailed, BANK_FEE_CATEGORIES) && !isProcessorFee(t.description),
      );
      return {
        line:
          fees.length === 0 ? `None in ${spanOf(f.days)}` : `Refunded in full in ${spanOf(f.days)}`,
        detail: `Jane looked at ${plural(f.transactions, "transaction")} for overdraft, ATM and account fees.`,
      };
    },
  },
  idle_cash: {
    label: "Idle cash",
    missing: first(shortHistory(CHECKUP_MIN_HISTORY_DAYS), (f) =>
      cushion(f) ? null : "No checking or savings balance with spending to compare it to yet.",
    ),
    passed: (f) => {
      const c = cushion(f)!;
      return {
        line: `${formatWholeDollars(c.balanceCents)} cash, ${formatWholeDollars(c.cushionCents)} cushion`,
        detail: `You spend about ${formatWholeDollars(c.monthlyCents)} a month, so ${IDLE_CASH_MONTHS_OF_SPENDING} months is ${formatWholeDollars(c.cushionCents)}. Jane flags cash ${formatWholeDollars(IDLE_CASH_MIN_EXCESS_CENTS)} or more above that.`,
      };
    },
  },
  insurance_reshop: {
    label: "Insurance",
    missing: first(shortHistory(CHECKUP_MIN_RECURRING_DAYS), (f) =>
      insurance(f).length === 0 ? "No insurance bill in your statements yet." : null,
    ),
    passed: (f) => ({
      line: `${plural(insurance(f).length, "policy", "policies")} covered by a card`,
      detail: "A card you pay with already includes this cover.",
    }),
  },
  card_interest: {
    label: "Card interest",
    missing: first(shortHistory(CHECKUP_MIN_HISTORY_DAYS), (f) =>
      credit(f).length === 0 ? "No credit card linked yet." : null,
    ),
    passed: (f) => ({
      line: `None in ${spanOf(f.days)}`,
      detail: `Jane checked ${plural(credit(f).length, "card")} for interest charges.`,
    }),
  },
  low_balance_risk: {
    label: "Balance ahead",
    // The forecast needs the bills, so as much history as the recurring checks.
    missing: first(shortHistory(CHECKUP_MIN_RECURRING_DAYS), (f) =>
      forecastAccounts(f.input, FORECAST_DAYS).length === 0
        ? "No checking or savings balance yet."
        : null,
    ),
    passed: (f) => {
      const lowest = Math.min(
        ...forecastAccounts(f.input, FORECAST_DAYS).map((a) => a.lowest.balanceCents),
      );
      return {
        line: `Lowest ${formatWholeDollars(lowest)} in ${FORECAST_DAYS} days`,
        detail: `From your balance, the bills due and the pay expected. Jane warns under ${formatWholeDollars(LOW_BALANCE_CUSHION_CENTS)}.`,
      };
    },
  },
  duplicate_charge: {
    label: "Double charges",
    missing: shortHistory(CHECKUP_MIN_HISTORY_DAYS),
    passed: (f) => ({
      line: `None in ${spanOf(f.days)}`,
      detail: `Jane looks for the same amount at the same place within ${plural(DUPLICATE_CHARGE_WINDOW_DAYS, "day")}.`,
    }),
  },
  charge_after_cancel: {
    label: "Charges after cancelling",
    missing: () => null,
    skip: (f) => (f.input.cancelledMerchants ?? []).length === 0,
    passed: (f) => ({
      line: `None after ${plural((f.input.cancelledMerchants ?? []).length, "cancellation")}`,
      detail: "Jane watches every company it cancelled for a charge after.",
    }),
  },
  trial_conversion: {
    label: "Trials turned paid",
    missing: shortHistory(CHECKUP_MIN_HISTORY_DAYS),
    passed: (f) => ({
      line: `None in ${spanOf(Math.min(f.days, REFUND_MAX_AGE_DAYS))}`,
      detail: `A trial is a charge of ${formatCents(TRIAL_MAX_START_CENTS)} or less, then a full charge ${TRIAL_MIN_DAYS} to ${TRIAL_MAX_DAYS} days later.`,
    }),
  },
  bill_negotiation: {
    label: "Phone and internet",
    missing: first(shortHistory(CHECKUP_MIN_RECURRING_DAYS), (f) =>
      bills(f).length === 0 ? "No phone or internet bill in your statements yet." : null,
    ),
    passed: (f) => ({
      line: `${plural(bills(f).length, "bill")} at typical prices`,
      detail: bills(f)
        .map(
          ({ stream, benchmark }) =>
            `${stream.merchant} ${formatWholeDollars(Math.round(stream.annualCostCents! / MONTHS_PER_YEAR))} a month; typical is up to ${formatWholeDollars(benchmark.typicalHighCents)}.`,
        )
        .join(" "),
    }),
  },
  covered_by_card: {
    label: "Cover you pay for twice",
    missing: () => null,
    skip: (f) => Object.keys(f.input.cardProducts ?? {}).length === 0,
    passed: (f) => ({
      line: "None found",
      detail: `Jane checked your plans against ${plural(Object.keys(f.input.cardProducts ?? {}).length, "card")} with cover.`,
    }),
  },
};

const ORDER: readonly CheckStatus[] = ["found", "passed", "not_enough_data"];

function historyDays(input: DetectionInput): number {
  const earliest =
    input.historyFrom ??
    input.transactions.reduce((min, t) => (t.date < min ? t.date : min), input.asOf);
  const window = daysBetween(monthsBefore(input.asOf, LOOKBACK_MONTHS), input.asOf);
  return Math.max(0, Math.min(window, daysBetween(earliest, input.asOf)));
}

function foundLine(candidates: Candidate[], open: number): { line: string; detail: string } {
  const count = Math.max(candidates.length, open);
  return {
    line: `${count} found`,
    detail:
      candidates.length > 0
        ? candidates
            .slice(0, 3)
            .map((c) => `${c.title}.`)
            .join(" ")
        : "Listed above.",
  };
}

// The checkup for one person: found first, then passed, then the checks short of data.
// `open` counts the person's open findings by type, so a finding listed above never sits
// beside a "passed" line.
export function checkup(
  input: DetectionInput,
  open: Partial<Record<FindingType, number>> = {},
): CheckLine[] {
  const streams = buildStreams(input);
  const facts: Facts = {
    input,
    streams,
    days: historyDays(input),
    transactions: inLookback(input).length,
  };
  const found = new Map<FindingType, Candidate[]>();
  for (const c of detect(input)) found.set(c.type, [...(found.get(c.type) ?? []), c]);

  const lines = (Object.keys(CHECKS) as FindingType[]).flatMap((type): CheckLine[] => {
    const check = CHECKS[type];
    const candidates = found.get(type) ?? [];
    const openCount = open[type] ?? 0;
    if (candidates.length > 0 || openCount > 0) {
      return [{ type, label: check.label, status: "found", ...foundLine(candidates, openCount) }];
    }
    if (check.skip?.(facts)) return [];
    const missing = check.missing(facts);
    if (missing) {
      return [
        {
          type,
          label: check.label,
          status: "not_enough_data",
          line: "Not enough data yet",
          detail: missing,
        },
      ];
    }
    return [{ type, label: check.label, status: "passed", ...check.passed(facts) }];
  });
  return lines.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
}
