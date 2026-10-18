import type { AlertType } from "@/generated/prisma/client";
import {
  ALERT_RECENT_DAYS,
  BANK_FEE_CATEGORIES,
  CARD_INTEREST_CATEGORIES,
  DUPLICATE_CHARGE_EXCLUDED_PRIMARIES,
  DUPLICATE_CHARGE_MIN_CENTS,
  DUPLICATE_CHARGE_WINDOW_DAYS,
  LARGE_CHARGE_EXCLUDED_PRIMARIES,
  LARGE_CHARGE_MEDIAN_MULTIPLE,
  LARGE_CHARGE_MIN_CENTS,
  LARGE_CHARGE_MIN_HISTORY,
  NON_SPENDING_CATEGORIES,
} from "@/config/detection";
import { formatCents } from "@/lib/money";
import { byDate, inList, inLookback } from "./helpers";
import { buildStreams, merchantOf, type Stream } from "./streams";
import type { Candidate, DetectionInput, DetectionTransaction } from "./types";
import { addDays, daysBetween, median } from "./units";

// Alerts: things that just happened and are worth a look now. Like the rules, these are
// pure: the user's data and this scan's findings in, alerts out. Each alert's key names
// the event (a transaction, a new price, a month), so a rescan produces the same key and
// the database's unique index stops it being raised twice.

export type AlertCandidate = {
  type: AlertType;
  key: string;
  title: string;
  body: string;
};

export type AlertContext = {
  // Finding ids ("type\0key") that existed before this scan.
  knownFindings: ReadonlySet<string>;
  // The person's first scan: everything is new, so "new subscription" would be noise.
  firstScan: boolean;
};

const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

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
          body: `Charged on ${shortDate(date)}${yearly}. It's on your report if you want to look at it.`,
        },
      ];
    });
}

// Each recent bank or card fee.
export function feeAlerts(input: DetectionInput): AlertCandidate[] {
  return input.transactions
    .filter((t) => t.amountCents > 0 && isRecent(t.date, input.asOf))
    .filter((t) => inList(t.pfcDetailed, [...BANK_FEE_CATEGORIES, ...CARD_INTEREST_CATEGORIES]))
    .sort(byDate)
    .map((t): AlertCandidate => ({
      type: "fee_charged",
      key: t.id,
      title: `${formatCents(t.amountCents)} fee on ${accountName(input, t.accountId)}`,
      body: `"${t.description}" on ${shortDate(t.date)}. Banks often take a fee back when asked; it's on your report.`,
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
export function largeChargeAlerts(input: DetectionInput, streams: Stream[]): AlertCandidate[] {
  const byAccount = new Map<string, DetectionTransaction[]>();
  for (const t of oneOffSpending(input, streams)) {
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
        body: `On ${accountName(input, t.accountId)}, ${shortDate(t.date)}. That's much more than you usually spend there; if you don't recognize it, contact your bank.`,
      }));
  });
}

// The same amount at the same merchant on the same account, within the window. The
// later charge is the one flagged.
export function duplicateChargeAlerts(input: DetectionInput): AlertCandidate[] {
  const groups = new Map<string, DetectionTransaction[]>();
  for (const t of inLookback(input)) {
    if (
      t.amountCents < DUPLICATE_CHARGE_MIN_CENTS ||
      inList(t.pfcPrimary, DUPLICATE_CHARGE_EXCLUDED_PRIMARIES)
    ) {
      continue;
    }
    const merchant = merchantOf(t)?.key;
    if (!merchant) continue;
    const key = `${t.accountId}\u0000${merchant}\u0000${t.amountCents}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const alerts: AlertCandidate[] = [];
  for (const charges of groups.values()) {
    charges.sort(byDate);
    for (let i = 1; i < charges.length; i += 1) {
      const [first, second] = [charges[i - 1], charges[i]];
      if (
        daysBetween(first.date, second.date) <= DUPLICATE_CHARGE_WINDOW_DAYS &&
        isRecent(second.date, input.asOf)
      ) {
        alerts.push({
          type: "duplicate_charge",
          key: second.id,
          title: `Charged twice? ${formatCents(second.amountCents)} at ${merchantName(second)}`,
          body: `Two charges of ${formatCents(second.amountCents)} on ${accountName(input, second.accountId)}, ${shortDate(first.date)} and ${shortDate(second.date)}. If you only bought once, ask the merchant or your bank to reverse one.`,
        });
      }
    }
  }
  return alerts.sort((a, b) => a.key.localeCompare(b.key));
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
        body: `Based on your balance today and the bills coming up before your next deposit, around ${shortDate(lowestDate)}. Moving a bill's date or some money now can avoid an overdraft.`,
      };
    });
}

// Every alert for this scan, in a stable order.
export function detectAlerts(
  input: DetectionInput,
  candidates: Candidate[],
  context: AlertContext,
): AlertCandidate[] {
  const streams = buildStreams(input);
  return [
    ...largeChargeAlerts(input, streams),
    ...duplicateChargeAlerts(input),
    ...lowBalanceAlerts(candidates),
    ...feeAlerts(input),
    ...priceIncreaseAlerts(input, candidates),
    ...newSubscriptionAlerts(input, candidates, context),
  ];
}
