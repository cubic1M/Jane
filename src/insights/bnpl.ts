import {
  BNPL_AMOUNT_TOLERANCE_CENTS,
  BNPL_BIWEEKLY_DAYS,
  BNPL_GRACE_DAYS,
  BNPL_LOOKBACK_DAYS,
  BNPL_MONTHLY_DAYS,
  BNPL_PAY_IN_4_PAYMENTS,
  BNPL_PROVIDERS,
  type BnplProviderKey,
} from "@/config/debt";
import { DAY_MS, addDays } from "@/lib/dates";

// Buy now, pay later plans (spec step 109), found from the person's payments to Affirm,
// Klarna and Afterpay. Only what the payments show: a Pay in 4 plan's last payments and end
// date follow from its fixed schedule; a monthly plan's balance and rate aren't in the
// payments, so they stay unknown until the person types them. Pure.

export type BnplPayment = {
  // YYYY-MM-DD.
  date: string;
  // Plaid's convention: positive is money out.
  amountCents: number;
  description: string;
  merchantName: string | null;
};

export type BnplPlan = {
  // The company and the payment, stable while the plan runs: "klarna:6225".
  key: string;
  provider: BnplProviderKey;
  providerName: string;
  // pay_in_4: four payments two weeks apart. monthly: a payment a month, for an unknown
  // number of months. Anything else (one payment that could be either) is unknown.
  kind: "pay_in_4" | "monthly" | "unknown";
  paymentCents: number;
  paymentsMade: number;
  firstDate: string;
  lastDate: string;
  // When the next payment is expected; null when the schedule isn't known.
  nextDate: string | null;
  // Pay in 4 only: payments left, what's left to pay and the day of the last payment.
  paymentsLeft: number | null;
  balanceCents: number | null;
  payoffDate: string | null;
};

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

// Which company a payment went to, or null.
export function bnplProviderOf(payment: Pick<BnplPayment, "description" | "merchantName">) {
  const text = `${payment.merchantName ?? ""} ${payment.description}`.toLowerCase();
  return BNPL_PROVIDERS.find((p) => p.words.some((w) => text.includes(w))) ?? null;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const between = (n: number, range: { min: number; max: number }) =>
  n >= range.min && n <= range.max;

// The step between payments: two weeks for Pay in 4, a month for monthly plans.
const STEP_DAYS = { pay_in_4: 14, monthly: 30 } as const;

function planOf(
  provider: (typeof BNPL_PROVIDERS)[number],
  payments: BnplPayment[],
  asOf: string,
): BnplPlan | null {
  const dates = payments.map((p) => p.date).sort();
  const firstDate = dates[0];
  const lastDate = dates.at(-1)!;
  const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
  const sinceLast = daysBetween(lastDate, asOf);
  const paymentCents = payments.at(-1)!.amountCents;

  let kind: BnplPlan["kind"];
  if (gaps.length === 0) {
    // One payment: the first of a Pay in 4 at the companies known for it, while recent.
    kind =
      provider.key !== "affirm" && sinceLast <= BNPL_BIWEEKLY_DAYS.max ? "pay_in_4" : "unknown";
  } else {
    const gap = median(gaps);
    kind = between(gap, BNPL_BIWEEKLY_DAYS)
      ? "pay_in_4"
      : between(gap, BNPL_MONTHLY_DAYS)
        ? "monthly"
        : "unknown";
  }

  if (kind === "pay_in_4") {
    // Two plans of the same amount back to back: the payments since the last plan began.
    const paymentsMade = ((dates.length - 1) % BNPL_PAY_IN_4_PAYMENTS) + 1;
    const paymentsLeft = BNPL_PAY_IN_4_PAYMENTS - paymentsMade;
    const nextDate = paymentsLeft > 0 ? addDays(lastDate, STEP_DAYS.pay_in_4) : null;
    if (paymentsLeft === 0 || daysBetween(nextDate!, asOf) > BNPL_GRACE_DAYS) return null;
    return {
      key: `${provider.key}:${paymentCents}`,
      provider: provider.key,
      providerName: provider.name,
      kind,
      paymentCents,
      paymentsMade,
      firstDate: dates[dates.length - paymentsMade],
      lastDate,
      nextDate,
      paymentsLeft,
      balanceCents: paymentsLeft * paymentCents,
      payoffDate: addDays(lastDate, paymentsLeft * STEP_DAYS.pay_in_4),
    };
  }

  const nextDate = kind === "monthly" ? addDays(lastDate, STEP_DAYS.monthly) : null;
  // Still running while a payment could still be on its way.
  if (sinceLast > BNPL_MONTHLY_DAYS.max + BNPL_GRACE_DAYS) return null;
  return {
    key: `${provider.key}:${paymentCents}`,
    provider: provider.key,
    providerName: provider.name,
    kind,
    paymentCents,
    paymentsMade: dates.length,
    firstDate,
    lastDate,
    nextDate,
    paymentsLeft: null,
    balanceCents: null,
    payoffDate: null,
  };
}

// The plans still running on `asOf`, biggest payment first.
export function bnplPlans(payments: BnplPayment[], asOf: string): BnplPlan[] {
  const from = addDays(asOf, -BNPL_LOOKBACK_DAYS);
  // By company, then by payment amount (within a few cents).
  const groups = new Map<
    string,
    { provider: (typeof BNPL_PROVIDERS)[number]; rows: BnplPayment[] }[]
  >();
  for (const payment of [...payments].sort((a, b) => a.date.localeCompare(b.date))) {
    if (payment.amountCents <= 0 || payment.date < from || payment.date > asOf) continue;
    const provider = bnplProviderOf(payment);
    if (!provider) continue;
    const clusters = groups.get(provider.key) ?? [];
    const cluster = clusters.find(
      (c) =>
        Math.abs(c.rows.at(-1)!.amountCents - payment.amountCents) <= BNPL_AMOUNT_TOLERANCE_CENTS,
    );
    if (cluster) cluster.rows.push(payment);
    else clusters.push({ provider, rows: [payment] });
    groups.set(provider.key, clusters);
  }
  return [...groups.values()]
    .flat()
    .flatMap(({ provider, rows }) => planOf(provider, rows, asOf) ?? [])
    .sort((a, b) => b.paymentCents - a.paymentCents || a.key.localeCompare(b.key));
}
