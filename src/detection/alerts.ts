import type { AlertType } from "@/generated/prisma/client";
import {
  ALERT_RECENT_DAYS,
  BILL_REMINDER_DAYS,
  RENEWAL_ALERT_DAYS,
  RENEWAL_FREQUENCIES,
  LOW_BALANCE_CUSHION_CENTS,
  BANK_FEE_CATEGORIES,
  CARD_INTEREST_CATEGORIES,
  LARGE_CHARGE_EXCLUDED_PRIMARIES,
  LARGE_CHARGE_MEDIAN_MULTIPLE,
  LARGE_CHARGE_MIN_CENTS,
  LARGE_CHARGE_MIN_HISTORY,
  NON_SPENDING_CATEGORIES,
  NON_RENEWING_PRIMARIES,
  PAYMENT_CATEGORY_BY_ACCOUNT,
} from "@/config/detection";
import { ESTIMATED_TAX_ALERT_DAYS, SELF_EMPLOYED_INCOME_CATEGORIES } from "@/config/tax-pack";
import { formatCents } from "@/lib/money";
import { nextEstimatedTaxDate } from "@/planning/tax-pack";
import { estimatedTaxAlertCopy } from "@/planning/tax-pack-copy";
import { byDate, inList, inLookback, isProcessorFee, isRenewable } from "./helpers";
import { parseKey, unusualAlerts } from "./unusual";
import { expectedDates, forecastAccounts, upcomingBills } from "./forecast";
import { duplicatePairs } from "./rules/duplicate-charge";
import { buildStreams, merchantOf, type Stream } from "./streams";
import type { Candidate, DetectionInput, DetectionTransaction } from "./types";
import { addDays, median } from "./units";
import { dayLabel } from "@/lib/day-label";

// Alerts: things that just happened and are worth a look now. Like the rules, these are
// pure: the user's data and this scan's findings in, alerts out. Each alert's key names
// the event (a transaction, a new price, a month), so a rescan produces the same key and
// the database's unique index stops it being raised twice.

export type AlertCandidate = {
  type: AlertType;
  key: string;
  title: string;
  body: string;
  // Overrides the type's usual urgency (bill reminders are urgent only when short).
  urgent?: boolean;
};

export type AlertContext = {
  // Finding ids ("type\0key") that existed before this scan.
  knownFindings: ReadonlySet<string>;
  // The person's first scan: everything is new, so "new subscription" would be noise.
  firstScan: boolean;
  // Spec step 208: merchants the person said charges were theirs, with the amount.
  taught?: ReadonlyMap<string, number>;
  // Spec step 253: detailed categories this person's profile makes expected (a business
  // owner's payroll and suppliers), which are never unusual.
  expected?: ReadonlySet<string>;
  // Books QA: card and loan payment categories whose due date the bank reports. The
  // deadline reminds about those, so no second bill reminder.
  dueReported?: ReadonlySet<string>;
};

function isRecent(date: string | undefined, asOf: string): date is string {
  return date !== undefined && date > addDays(asOf, -ALERT_RECENT_DAYS) && date <= asOf;
}

function accountName(input: DetectionInput, accountId: string): string {
  return input.accounts.find((a) => a.id === accountId)?.name ?? "your account";
}

const merchantName = (t: DetectionTransaction) =>
  t.merchantName ?? merchantOf(t)?.name ?? t.description;

const lastChargeDate = (candidate: Candidate) =>
  (candidate.evidence.charges as { date: string }[] | undefined)?.at(-1)?.date;

const idOf = (c: { type: string; key: string }) => `${c.type}\u0000${c.key}`;

// A subscription finding this scan created, whose latest charge is recent.
export function newSubscriptionAlerts(
  input: DetectionInput,
  candidates: Candidate[],
  context: AlertContext,
): AlertCandidate[] {
  if (context.firstScan) return [];
  return candidates
    .filter((c) => c.type === "subscription_review" && !context.knownFindings.has(idOf(c)))
    .filter((c) => isRecent(lastChargeDate(c), input.asOf))
    .map((c): AlertCandidate => {
      const merchant = String(c.evidence.merchant ?? "A subscription");
      const last = Number(c.evidence.lastAmountCents);
      return {
        type: "new_subscription",
        key: c.key,
        title: `New subscription: ${merchant}, ${formatCents(last)}`,
        body: `We spotted a new recurring charge from ${merchant}. If you didn't mean to sign up, it's on your report.`,
      };
    });
}

// A price increase whose new price was charged recently. Keyed by the charge date, so
// a later increase at the same merchant is a new alert.
export function priceIncreaseAlerts(
  input: DetectionInput,
  candidates: Candidate[],
): AlertCandidate[] {
  return candidates
    .filter((c) => c.type === "price_increase")
    .flatMap((c): AlertCandidate[] => {
      const date = lastChargeDate(c);
      if (!isRecent(date, input.asOf)) return [];
      const yearly = c.annualSavingsCents
        ? `, about ${formatCents(c.annualSavingsCents)} a year more`
        : "";
      return [
        {
          type: "price_increase",
          key: `${c.key}:${date}`,
          title: c.title,
          body: `Charged on ${dayLabel(date)}${yearly}. It's on your report if you want to look at it.`,
        },
      ];
    });
}

// Each recent bank or card fee.
export function feeAlerts(input: DetectionInput): AlertCandidate[] {
  return input.transactions
    .filter((t) => t.amountCents > 0 && isRecent(t.date, input.asOf))
    .filter((t) => inList(t.pfcDetailed, [...BANK_FEE_CATEGORIES, ...CARD_INTEREST_CATEGORIES]))
    .filter((t) => !isProcessorFee(t.description))
    .sort(byDate)
    .map((t): AlertCandidate => ({
      type: "fee_charged",
      key: t.id,
      title: `${formatCents(t.amountCents)} fee on ${accountName(input, t.accountId)}`,
      body: `"${t.description}" on ${dayLabel(t.date)}. Banks often take a fee back when asked; it's on your report.`,
    }));
}

// Spending on the account that isn't a recurring bill or money being moved.
function oneOffSpending(input: DetectionInput, streams: Stream[]): DetectionTransaction[] {
  const recurring = new Set(streams.flatMap((s) => s.charges.map((c) => c.id)));
  return inLookback(input).filter(
    (t) =>
      t.amountCents > 0 &&
      !recurring.has(t.id) &&
      !inList(t.pfcPrimary, LARGE_CHARGE_EXCLUDED_PRIMARIES) &&
      !inList(t.pfcDetailed, NON_SPENDING_CATEGORIES),
  );
}

// A recent charge far above the account's typical charge. Needs enough history to know
// what typical is.
export function largeChargeAlerts(
  input: DetectionInput,
  streams: Stream[],
  // Kinds of payment the person's profile makes expected (a business owner's payroll and
  // suppliers, as the unusual-activity check uses them): never a large charge to worry about.
  expected: ReadonlySet<string> = new Set(),
): AlertCandidate[] {
  const byAccount = new Map<string, DetectionTransaction[]>();
  for (const t of oneOffSpending(input, streams)) {
    if (t.pfcDetailed && expected.has(t.pfcDetailed)) continue;
    byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t]);
  }
  return [...byAccount.values()].flatMap((charges) => {
    if (charges.length < LARGE_CHARGE_MIN_HISTORY) return [];
    const typical = median(charges.map((c) => c.amountCents));
    return charges
      .filter(
        (t) =>
          isRecent(t.date, input.asOf) &&
          t.amountCents >= LARGE_CHARGE_MIN_CENTS &&
          t.amountCents >= typical * LARGE_CHARGE_MEDIAN_MULTIPLE,
      )
      .sort(byDate)
      .map((t): AlertCandidate => ({
        type: "large_charge",
        key: t.id,
        title: `${formatCents(t.amountCents)} at ${merchantName(t)}`,
        body: `On ${accountName(input, t.accountId)}, ${dayLabel(t.date)}. That's much more than you usually spend there; if you don't recognize it, contact your bank.`,
      }));
  });
}

// The later of two identical charges (see rules/duplicate-charge.ts), when recent.
export function duplicateChargeAlerts(input: DetectionInput): AlertCandidate[] {
  return duplicatePairs(input)
    .filter(({ second }) => isRecent(second.date, input.asOf))
    .map(({ first, second }): AlertCandidate => ({
      type: "duplicate_charge",
      key: second.id,
      title: `Charged twice? ${formatCents(second.amountCents)} at ${merchantName(second)}`,
      body: `Two charges of ${formatCents(second.amountCents)} on ${accountName(input, second.accountId)}, ${dayLabel(first.date)} and ${dayLabel(second.date)}. If you only bought once, it's on your report and we can ask for the money back.`,
    }));
}

// A low-balance forecast, at most once per account per month the dip falls in.
export function lowBalanceAlerts(candidates: Candidate[]): AlertCandidate[] {
  return candidates
    .filter((c) => c.type === "low_balance_risk")
    .map((c): AlertCandidate => {
      const lowestDate = String(c.evidence.lowestDate);
      return {
        type: "low_balance",
        key: `${c.key}:${lowestDate.slice(0, "YYYY-MM".length)}`,
        title: c.title,
        body: `That's from your balance today and the bills due before your next deposit. Moving a bill's date or some money now can avoid an overdraft.`,
      };
    });
}

// The card and loan payment categories the bank's due dates already cover: those where every
// account of that kind reports an upcoming due date (one without leaves the bill reminder on).
export function dueReportedCategories(
  accounts: { type: string; subtype: string | null; nextDue: string | null }[],
  asOf: string,
): Set<string> {
  const byCategory = new Map<string, boolean>();
  for (const a of accounts) {
    const category =
      PAYMENT_CATEGORY_BY_ACCOUNT[a.type] ?? PAYMENT_CATEGORY_BY_ACCOUNT[a.subtype ?? ""];
    if (!category) continue;
    const reported = a.nextDue !== null && a.nextDue >= asOf;
    byCategory.set(category, (byCategory.get(category) ?? true) && reported);
  }
  return new Set([...byCategory].filter(([, all]) => all).map(([category]) => category));
}

// A regular bill due in the next BILL_REMINDER_DAYS, one per bill per due date. Urgent
// only when its account is forecast below the cushion on that day. A card or loan payment
// whose due date the bank reports is left to that deadline; money running short before it
// is still the low-balance alert's.
export function billReminderAlerts(
  input: DetectionInput,
  dueReported: ReadonlySet<string> = new Set(),
): AlertCandidate[] {
  const until = addDays(input.asOf, BILL_REMINDER_DAYS);
  const forecasts = forecastAccounts(input, BILL_REMINDER_DAYS);
  const balanceOn = (accountId: string | null, date: string) =>
    forecasts.find((f) => f.accountId === accountId)?.days.find((d) => d.date === date)
      ?.balanceCents;
  return upcomingBills(input, BILL_REMINDER_DAYS, dueReported)
    .filter((b) => b.date > input.asOf && b.date <= until)
    .map((b): AlertCandidate => {
      const balance = balanceOn(b.accountId, b.date);
      const short = balance !== undefined && balance < LOW_BALANCE_CUSHION_CENTS;
      return {
        type: "bill_due",
        key: `${b.merchant}:${b.date}`,
        title: `${b.merchant}, about ${formatCents(b.amountCents)}, due ${dayLabel(b.date)}`,
        body: short
          ? `Your balance could be about ${formatCents(balance)} that day, so there may not be enough. Moving money in first could avoid a fee.`
          : "Expected from your past charges; the date and amount are estimates.",
        urgent: short,
      };
    });
}

// A yearly or quarterly charge about to renew, once per renewal date. Monthly charges are
// left out: they come round too often to be news.
export function renewalAlerts(input: DetectionInput, streams: Stream[]): AlertCandidate[] {
  const until = addDays(input.asOf, RENEWAL_ALERT_DAYS);
  return streams
    .filter(
      (s) =>
        s.active &&
        s.frequency !== null &&
        RENEWAL_FREQUENCIES.includes(s.frequency) &&
        !(s.pfcPrimary && NON_RENEWING_PRIMARIES.includes(s.pfcPrimary)) &&
        isRenewable(s),
    )
    .flatMap((s) =>
      expectedDates(s, input.asOf, until)
        .filter((date) => date > input.asOf)
        .map((date): AlertCandidate => ({
          type: "renews_soon",
          key: `${s.key}:${date}`,
          title: `${s.merchant} renews ${dayLabel(date)}, about ${formatCents(s.lastAmountCents)}`,
          body: "If you don't want another year (or quarter), cancel before then. It's on your subscriptions page.",
        })),
    );
}

// The next IRS estimated-payment date, ESTIMATED_TAX_ALERT_DAYS ahead, for people with
// contracting or gig income in the lookback (spec step 72). Keyed by the date, so it's raised
// once per date. A reminder only: never an amount.
export function estimatedTaxAlerts(input: DetectionInput): AlertCandidate[] {
  const hasIncome = input.transactions.some(
    (t) => t.amountCents < 0 && inList(t.pfcDetailed, SELF_EMPLOYED_INCOME_CATEGORIES),
  );
  if (!hasIncome) return [];
  const date = nextEstimatedTaxDate(input.asOf);
  if (date > addDays(input.asOf, ESTIMATED_TAX_ALERT_DAYS)) return [];
  return [{ type: "estimated_tax", key: date, ...estimatedTaxAlertCopy(dayLabel(date)) }];
}

// One alert per charge (docs/feature-audit.md, cluster 10). A charge the unusual rules ask
// "Was this you?" about doesn't also get the large-charge alert: that one asks the same, with
// the buttons and the teaching. A charge that is "Charged twice?" (a refund card) doesn't also
// get the unusual "charged twice this month". Run on the alerts the person wants, so turning
// one kind off never silences the other.
export function onePerCharge(alerts: AlertCandidate[]): AlertCandidate[] {
  const chargedTwice = new Set(
    alerts.filter((a) => a.type === "duplicate_charge").map((a) => a.key),
  );
  const kept = alerts.filter((a) => {
    if (a.type !== "unusual_activity") return true;
    const parsed = parseKey(a.key);
    return !(parsed?.rule === "double" && chargedTwice.has(parsed.transactionId));
  });
  const wasThisYou = new Set(
    kept.flatMap((a) =>
      a.type === "unusual_activity" ? (parseKey(a.key)?.transactionId ?? []) : [],
    ),
  );
  return kept.filter((a) => !(a.type === "large_charge" && wasThisYou.has(a.key)));
}

// Every alert for this scan, in a stable order.
export function detectAlerts(
  input: DetectionInput,
  candidates: Candidate[],
  context: AlertContext,
): AlertCandidate[] {
  const streams = buildStreams(input);
  return [
    ...largeChargeAlerts(input, streams, context.expected),
    ...duplicateChargeAlerts(input),
    ...lowBalanceAlerts(candidates),
    ...feeAlerts(input),
    ...priceIncreaseAlerts(input, candidates),
    ...newSubscriptionAlerts(input, candidates, context),
    ...billReminderAlerts(input, context.dueReported),
    ...renewalAlerts(input, streams),
    ...estimatedTaxAlerts(input),
    ...unusualAlerts(input, streams, context.taught, context.expected),
  ];
}
