import {
  UNUSUAL_BILL_MIN_HISTORY,
  UNUSUAL_BILL_MIN_RISE_CENTS,
  UNUSUAL_BILL_PRIMARIES,
  UNUSUAL_BILL_RISE_SHARE,
  UNUSUAL_DOUBLE_SUBSCRIPTION_DAYS,
  UNUSUAL_DOUBLE_MIN_CHARGES,
  UNUSUAL_MONTHLY_GAP_DAYS,
  UNUSUAL_MERCHANT_MIN_CENTS,
  UNUSUAL_MERCHANT_MIN_HISTORY,
  UNUSUAL_MERCHANT_MULTIPLE,
  UNUSUAL_NEW_MERCHANT_MIN_CENTS,
  UNUSUAL_NEW_MERCHANT_MIN_HISTORY_DAYS,
  UNUSUAL_TAUGHT_MULTIPLE,
  LARGE_CHARGE_EXCLUDED_PRIMARIES,
  NON_SPENDING_CATEGORIES,
  ALERT_RECENT_DAYS,
} from "@/config/detection";
import { formatCents } from "@/lib/money";
import { inList } from "./helpers";
import { priceIncrease } from "./rules/price-increase";
import { buildStreams, merchantOf, type Stream } from "./streams";
import type { DetectionInput, DetectionTransaction } from "./types";
import { addDays, daysBetween, median } from "./units";
import { dayLabel } from "@/lib/day-label";

// Spotting the unusual (spec step 208). Pure: charges that don't look right, across every
// account, each as one alert with "this was me" and "not me". Thresholds are in
// src/config/detection.ts. The alert key is "<rule>:<merchant key>:<transaction id>", so
// answering it can say which merchant it teaches.

export type UnusualRule = "spike" | "new_merchant" | "bill_rise" | "double" | "refund";

export type UnusualAlert = {
  type: "unusual_activity";
  key: string;
  title: string;
  body: string;
};

// What the person told Jane was them: merchant key -> the largest amount they said was
// theirs. Later charges up to UNUSUAL_TAUGHT_MULTIPLE times it stay quiet.
export type Taught = ReadonlyMap<string, number>;

const recent = (date: string, asOf: string) =>
  date > addDays(asOf, -ALERT_RECENT_DAYS) && date <= asOf;

export function keyOf(rule: UnusualRule, merchantKey: string, transactionId: string) {
  return `${rule}:${merchantKey}:${transactionId}`;
}
export function parseKey(
  key: string,
): { rule: string; merchantKey: string; transactionId: string } | null {
  const [rule, ...rest] = key.split(":");
  const transactionId = rest.pop();
  if (!rule || !transactionId || rest.length === 0) return null;
  return { rule, merchantKey: rest.join(":"), transactionId };
}

export function unusualAlerts(
  input: DetectionInput,
  streams: Stream[] = buildStreams(input),
  taught: Taught = new Map(),
  expected: ReadonlySet<string> = new Set(),
): UnusualAlert[] {
  const out: UnusualAlert[] = [];
  const spending = input.transactions.filter(
    (t) =>
      t.amountCents > 0 &&
      !inList(t.pfcPrimary, LARGE_CHARGE_EXCLUDED_PRIMARIES) &&
      !inList(t.pfcDetailed, NON_SPENDING_CATEGORIES),
  );
  const byMerchant = new Map<string, DetectionTransaction[]>();
  for (const t of spending) {
    const key = merchantOf(t)?.key;
    if (key) byMerchant.set(key, [...(byMerchant.get(key) ?? []), t]);
  }
  const quiet = (merchantKey: string, cents: number) => {
    const told = taught.get(merchantKey);
    return told !== undefined && cents <= told * UNUSUAL_TAUGHT_MULTIPLE;
  };
  const name = (t: DetectionTransaction) => t.merchantName ?? merchantOf(t)?.name ?? t.description;
  const oldest = input.transactions.reduce((min, t) => (t.date < min ? t.date : min), input.asOf);
  const knownDays = daysBetween(oldest, input.asOf);

  for (const [merchantKey, charges] of byMerchant) {
    const sorted = [...charges].sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    );
    sorted.forEach((t, i) => {
      if (!recent(t.date, input.asOf) || quiet(merchantKey, t.amountCents)) return;
      // Their profile says this kind of payment is normal (a business owner's payroll).
      if (t.pfcDetailed && expected.has(t.pfcDetailed)) return;
      const earlier = sorted.slice(0, i);
      // 1. Far above usual for this merchant.
      if (earlier.length >= UNUSUAL_MERCHANT_MIN_HISTORY) {
        const typical = median(earlier.map((c) => c.amountCents));
        if (
          t.amountCents >= UNUSUAL_MERCHANT_MIN_CENTS &&
          t.amountCents >= typical * UNUSUAL_MERCHANT_MULTIPLE
        ) {
          out.push({
            type: "unusual_activity",
            key: keyOf("spike", merchantKey, t.id),
            title: `${formatCents(t.amountCents)} at ${name(t)}, far above usual`,
            body: `On ${dayLabel(t.date)}. You usually pay about ${formatCents(typical)} there.`,
          });
          return;
        }
      }
      // 2. A large first charge from a merchant never seen before.
      if (
        earlier.length === 0 &&
        knownDays >= UNUSUAL_NEW_MERCHANT_MIN_HISTORY_DAYS &&
        t.amountCents >= UNUSUAL_NEW_MERCHANT_MIN_CENTS
      ) {
        out.push({
          type: "unusual_activity",
          key: keyOf("new_merchant", merchantKey, t.id),
          title: `${formatCents(t.amountCents)} at ${name(t)}, a first charge`,
          body: `On ${dayLabel(t.date)}. You haven't paid ${name(t)} before.`,
        });
      }
    });
  }

  // 3. A regular bill much higher than usual. Not one that's a price rise (a phone or internet
  // bill with a steady price): its price-rise card and heads-up say it already
  // (docs/feature-audit.md, cluster 10).
  for (const s of streams) {
    if (!s.active || !s.pfcPrimary || !UNUSUAL_BILL_PRIMARIES.includes(s.pfcPrimary)) continue;
    if (priceIncrease(input, [s]).length > 0) continue;
    const last = s.charges.at(-1);
    const merchantKey = s.merchantKey;
    if (
      !last ||
      !recent(last.date, input.asOf) ||
      s.priorAverageCents === null ||
      s.priorCount < UNUSUAL_BILL_MIN_HISTORY
    )
      continue;
    const rise = last.amountCents - s.priorAverageCents;
    if (
      rise >= UNUSUAL_BILL_MIN_RISE_CENTS &&
      rise >= s.priorAverageCents * UNUSUAL_BILL_RISE_SHARE &&
      !quiet(merchantKey, last.amountCents)
    ) {
      out.push({
        type: "unusual_activity",
        key: keyOf("bill_rise", merchantKey, last.id),
        title: `${s.merchant} bill is ${formatCents(rise)} higher than usual`,
        body: `${formatCents(last.amountCents)} on ${dayLabel(last.date)}, where it's usually about ${formatCents(s.priorAverageCents)}.`,
      });
    }
  }

  // 4. A monthly charge made twice close together: the merchant has charged about monthly,
  // for the same amount, and the latest two are less than UNUSUAL_DOUBLE_SUBSCRIPTION_DAYS apart.
  for (const [merchantKey, charges] of byMerchant) {
    const sorted = [...charges].sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    );
    if (sorted.length < UNUSUAL_DOUBLE_MIN_CHARGES) continue;
    const a = sorted[sorted.length - 1 - 1];
    const b = sorted[sorted.length - 1];
    const before = sorted.slice(0, -1);
    const gaps = before.slice(1).map((c, i) => daysBetween(before[i].date, c.date));
    const monthly =
      median(gaps) >= UNUSUAL_MONTHLY_GAP_DAYS.min && median(gaps) <= UNUSUAL_MONTHLY_GAP_DAYS.max;
    if (
      monthly &&
      a.amountCents === b.amountCents &&
      recent(b.date, input.asOf) &&
      daysBetween(a.date, b.date) < UNUSUAL_DOUBLE_SUBSCRIPTION_DAYS &&
      !quiet(merchantKey, b.amountCents)
    ) {
      out.push({
        type: "unusual_activity",
        key: keyOf("double", merchantKey, b.id),
        title: `${name(b)} charged twice this month`,
        body: `${formatCents(a.amountCents)} on ${dayLabel(a.date)} and ${formatCents(b.amountCents)} on ${dayLabel(b.date)}, though it's a monthly charge.`,
      });
    }
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}
