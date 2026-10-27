import {
  ACTIVE_WITHIN_INTERVALS,
  BILLING_PLATFORM_MERCHANTS,
  CHARGES_PER_YEAR,
  FALLBACK_AMOUNT_TOLERANCE,
  FALLBACK_INTERVAL_DAYS,
  FALLBACK_MIN_CHARGES,
  RUN_MIN_SHARE_OF_CHARGES,
  SHORT_RUN_CATEGORIES,
  SHORT_RUN_MIN_CHARGES,
  SUBSCRIPTION_MERCHANTS,
  VARIABLE_BILL_CATEGORIES,
  HIGH_CONFIDENCE_MIN_CHARGES,
  YEARLY_PLAN_GOODS_WORDS,
  YEARLY_PLAN_MAX_CENTS,
  YEARLY_PLAN_MIN_CENTS,
  YEARLY_PLAN_WORDS,
  type ConfidenceLevel,
  type Frequency,
} from "@/config/detection";
import { normalizeMerchant } from "@/data-sources/merchant";
import { byDate, inList, inLookback, merchantMatches } from "./helpers";
import type { DetectionInput, DetectionRecurringStream, DetectionTransaction } from "./types";
import { average, daysBetween, median } from "./units";

// A recurring outflow, from Plaid's recurring streams when we have them, otherwise found
// in the transactions by our own fallback. Rules only ever see this shape.
export type Stream = {
  // Stable finding key, e.g. "merchant:netflix".
  key: string;
  merchant: string;
  merchantKey: string;
  frequency: Frequency | null;
  // Oldest first. Can be empty for a Plaid stream whose transactions we don't have.
  charges: DetectionTransaction[];
  lastAmountCents: number;
  // Average of the charges before the latest one, and how many there were.
  priorAverageCents: number | null;
  priorCount: number;
  // Latest amount at the stream's frequency for a year; null if the frequency is unknown.
  annualCostCents: number | null;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  active: boolean;
  confidence: ConfidenceLevel;
  // The account it's charged to, the last charge date, and Plaid's predicted next date.
  accountId: string | null;
  lastDate: string | null;
  predictedNextDate: string | null;
  // A yearly plan seen once, found by the plan's own name: a subscription whatever its category.
  namedPlan?: true;
};

export function merchantOf(t: DetectionTransaction) {
  return normalizeMerchant(t.merchantName ?? t.description) ?? normalizeMerchant(t.description);
}

function priorStats(charges: DetectionTransaction[]) {
  const prior = charges.slice(0, -1).map((c) => c.amountCents);
  return {
    priorAverageCents: prior.length > 0 ? Math.round(average(prior)) : null,
    priorCount: prior.length,
  };
}

function annualCost(amountCents: number, frequency: Frequency | null): number | null {
  return frequency ? amountCents * CHARGES_PER_YEAR[frequency] : null;
}

// The most common category among the charges; ties go to the alphabetically first name.
function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  for (const [value, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    if (best === null || count > (counts.get(best) ?? 0)) best = value;
  }
  return best;
}

function isFrequency(value: string): value is Frequency {
  return Object.hasOwn(CHARGES_PER_YEAR, value);
}

const PLAID_STATUS_CONFIDENCE: Record<string, ConfidenceLevel> = {
  MATURE: "high",
  EARLY_DETECTION: "medium",
};

export function fromPlaidStream(
  stream: DetectionRecurringStream,
  byPlaidId: Map<string, DetectionTransaction>,
): Stream {
  const charges = stream.transactionIds
    .map((id) => byPlaidId.get(id))
    .filter((t): t is DetectionTransaction => t !== undefined)
    .sort(byDate);
  const merchant = normalizeMerchant(stream.merchantName ?? "");
  const merchantKey = merchant?.key ?? stream.plaidStreamId;
  const frequency = isFrequency(stream.frequency) ? stream.frequency : null;
  return {
    key: `merchant:${merchantKey}`,
    merchant: stream.merchantName ?? merchant?.name ?? "A recurring charge",
    merchantKey,
    frequency,
    charges,
    lastAmountCents: stream.lastAmountCents,
    ...priorStats(charges),
    annualCostCents: annualCost(stream.lastAmountCents, frequency),
    pfcPrimary: stream.pfcPrimary,
    pfcDetailed: stream.pfcDetailed,
    active: stream.isActive && stream.status !== "TOMBSTONED",
    confidence: PLAID_STATUS_CONFIDENCE[stream.status] ?? "low",
    accountId: stream.accountId,
    lastDate: stream.lastDate ?? charges.at(-1)?.date ?? null,
    predictedNextDate: stream.predictedNextDate ?? null,
  };
}

function frequencyOf(gaps: number[]): Frequency | null {
  for (const [frequency, [min, max]] of Object.entries(FALLBACK_INTERVAL_DAYS)) {
    if (gaps.every((gap) => gap >= min && gap <= max)) return frequency as Frequency;
  }
  return null;
}

function withinTolerance(amount: number, reference: number): boolean {
  return Math.abs(amount - reference) <= reference * FALLBACK_AMOUNT_TOLERANCE;
}

const isVariable = (charges: DetectionTransaction[]) =>
  inList(mostCommon(charges.map((c) => c.pfcDetailed)), VARIABLE_BILL_CATEGORIES);

// Where two charges a month apart can only be a bill or a subscription.
function shortRunAllowed(charges: DetectionTransaction[]): boolean {
  const key = merchantOf(charges[charges.length - 1])?.key ?? "";
  return (
    inList(mostCommon(charges.map((c) => c.pfcDetailed)), SHORT_RUN_CATEGORIES) ||
    merchantMatches(key, SUBSCRIPTION_MERCHANTS) ||
    merchantMatches(key, BILLING_PLATFORM_MERCHANTS)
  );
}

// Fallback: at one merchant, the charges near the typical amount must come at a regular
// gap. Charges after that run, at the same gap but a new price (within tolerance of each
// other), are kept as the run's newest charges so price increases show up.
function detectRun(charges: DetectionTransaction[], asOf: string): Stream | null {
  const typical = median(charges.map((c) => c.amountCents));
  // A usage bill or a card payment: every charge counts, whatever its amount, and the regular
  // gap is what makes it a bill.
  const variable = isVariable(charges);
  const core = variable ? charges : charges.filter((c) => withinTolerance(c.amountCents, typical));
  const short = core.length < FALLBACK_MIN_CHARGES;
  if (core.length < (shortRunAllowed(charges) ? SHORT_RUN_MIN_CHARGES : FALLBACK_MIN_CHARGES)) {
    return null;
  }

  const gaps = core.slice(1).map((c, i) => daysBetween(core[i].date, c.date));
  const frequency = frequencyOf(gaps);
  const range = frequency && FALLBACK_INTERVAL_DAYS[frequency];
  if (!frequency || !range) return null;
  // Two charges are only a run a month apart: a week apart is a second purchase.
  if (short && frequency !== "MONTHLY") return null;
  const [min, max] = range;

  const run = [...core];
  for (const charge of charges) {
    const last = run[run.length - 1];
    if (charge.date <= last.date) continue;
    const gap = daysBetween(last.date, charge.date);
    const firstNewPrice = run.length === core.length;
    if (
      gap >= min &&
      gap <= max &&
      (variable || firstNewPrice || withinTolerance(charge.amountCents, last.amountCents))
    ) {
      run.push(charge);
    }
  }

  const last = run[run.length - 1];
  const merchant = merchantOf(last);
  if (!merchant) return null;
  const usualGap = median(gaps);
  return {
    key: `merchant:${merchant.key}`,
    merchant: last.merchantName ?? merchant.name,
    merchantKey: merchant.key,
    frequency,
    charges: run,
    lastAmountCents: last.amountCents,
    ...priorStats(run),
    annualCostCents: annualCost(last.amountCents, frequency),
    pfcPrimary: mostCommon(run.map((c) => c.pfcPrimary)),
    pfcDetailed: mostCommon(run.map((c) => c.pfcDetailed)),
    active: daysBetween(last.date, asOf) <= usualGap * ACTIVE_WITHIN_INTERVALS,
    confidence:
      run.length >= HIGH_CONFIDENCE_MIN_CHARGES
        ? "high"
        : run.length < FALLBACK_MIN_CHARGES
          ? "low"
          : "medium",
    accountId: last.accountId,
    lastDate: last.date,
    predictedNextDate: null,
  };
}

// The merchant is a subscription by its own name ("dropbox", "duolingo plus"), not a longer one.
const isPlanName = (key: string) =>
  SUBSCRIPTION_MERCHANTS.some(
    (name) =>
      key === name ||
      (key.startsWith(`${name} `) && YEARLY_PLAN_WORDS.includes(key.slice(name.length + 1))),
  );

// The description's words, lower case: "PELOTON* APPAREL" is ["peloton", "apparel"].
const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9&]+/)
    .filter(Boolean);

// The plan named after the processor's "*", which the merchant name drops: "MICROSOFT*MICROSOFT
// 365 P" is Microsoft 365 (the bank cut "PERSONAL" to "P"; one-letter ends are left off).
function planAfterStar(description: string): boolean {
  const star = description.indexOf("*");
  if (star < 0) return false;
  const words = wordsOf(description.slice(star + 1));
  while (words.length > 1 && words[words.length - 1].length === 1) words.pop();
  return words.length > 0 && isPlanName(words.join(" "));
}

const isGoods = (description: string) =>
  wordsOf(description).some((w) => YEARLY_PLAN_GOODS_WORDS.includes(w));

// A yearly plan seen once: one charge, in YEARLY_PLAN_*_CENTS, under the plan's own name, and not
// something from the company's shop.
function yearlyPlan(charges: DetectionTransaction[]): Stream | null {
  const plans = charges.filter(
    (c) => c.amountCents >= YEARLY_PLAN_MIN_CENTS && c.amountCents <= YEARLY_PLAN_MAX_CENTS,
  );
  const merchant = plans.length === 1 ? merchantOf(plans[0]) : null;
  if (!merchant || isGoods(plans[0].description)) return null;
  if (!isPlanName(merchant.key) && !planAfterStar(plans[0].description)) return null;
  const [plan] = plans;
  return {
    key: `merchant:${merchant.key}`,
    merchant: plan.merchantName ?? merchant.name,
    merchantKey: merchant.key,
    frequency: "ANNUALLY",
    charges: [plan],
    lastAmountCents: plan.amountCents,
    ...priorStats([plan]),
    annualCostCents: annualCost(plan.amountCents, "ANNUALLY"),
    pfcPrimary: plan.pfcPrimary,
    pfcDetailed: plan.pfcDetailed,
    // Inside the lookback, so within a year: not due again yet.
    active: true,
    confidence: "low",
    accountId: plan.accountId,
    lastDate: plan.date,
    predictedNextDate: null,
    namedPlan: true,
  };
}

// Every run at one merchant: the run at its usual price, unless it's only a few of many
// charges there at prices that just look alike (a grocer's bills that happened to land a month
// apart). An app store is different: it bills several subscriptions, each at its own exact
// price, among one-off purchases at any price, so there each exact price that comes regularly
// is a run of its own. Every run after the first keeps the merchant's key with its price
// ("merchant:apple@1099"), so every finding's key stays unique. With no run at all, a yearly
// plan seen once.
function detectRuns(charges: DetectionTransaction[], asOf: string): Stream[] {
  const key = merchantOf(charges[charges.length - 1])?.key ?? "";
  if (!merchantMatches(key, BILLING_PLATFORM_MERCHANTS)) {
    const main = detectRun(charges, asOf);
    if (
      main &&
      (isVariable(charges) || main.charges.length >= charges.length * RUN_MIN_SHARE_OF_CHARGES)
    )
      return [main];
    const plan = yearlyPlan(charges);
    return plan ? [plan] : [];
  }
  const runs: Stream[] = [];
  const byPrice = new Map<number, DetectionTransaction[]>();
  for (const c of charges) byPrice.set(c.amountCents, [...(byPrice.get(c.amountCents) ?? []), c]);
  for (const [, same] of [...byPrice].sort(([a], [b]) => a - b)) {
    const run = detectRun(same, asOf);
    if (run)
      runs.push(runs.length === 0 ? run : { ...run, key: `${run.key}@${run.lastAmountCents}` });
  }
  return runs;
}

export function detectRecurring(input: DetectionInput): Stream[] {
  const groups = new Map<string, DetectionTransaction[]>();
  for (const t of inLookback(input)) {
    if (t.amountCents <= 0) continue;
    const key = merchantOf(t)?.key;
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.keys()]
    .sort()
    .flatMap((key) => detectRuns((groups.get(key) ?? []).sort(byDate), input.asOf));
}

// Outflow streams only (Plaid gives outflows positive amounts, like transactions). Plaid's
// streams cover the accounts Plaid reported them for; every other account (CSV imports,
// or a Plaid item without the recurring add-on) goes through our own fallback, so
// founders' CSV data keeps working next to linked accounts.
export function buildStreams(input: DetectionInput): Stream[] {
  if (input.recurringStreams.length === 0) return detectRecurring(input);

  const byPlaidId = new Map(
    input.transactions.flatMap((t) => (t.plaidTransactionId ? [[t.plaidTransactionId, t]] : [])),
  );
  const fromPlaid = input.recurringStreams
    .filter((s) => s.averageAmountCents > 0)
    .sort((a, b) => a.plaidStreamId.localeCompare(b.plaidStreamId))
    .map((s) => fromPlaidStream(s, byPlaidId));

  const covered = new Set(input.recurringStreams.map((s) => s.accountId));
  const fallback = detectRecurring({
    ...input,
    transactions: input.transactions.filter((t) => !covered.has(t.accountId)),
  });
  const keys = new Set(fromPlaid.map((s) => s.key));
  return [...fromPlaid, ...fallback.filter((s) => !keys.has(s.key))];
}
