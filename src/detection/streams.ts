import {
  ACTIVE_WITHIN_INTERVALS,
  BILLING_PLATFORM_MERCHANTS,
  CHARGES_PER_YEAR,
  FALLBACK_AMOUNT_TOLERANCE,
  FALLBACK_INTERVAL_DAYS,
  FALLBACK_MIN_CHARGES,
  RUN_MIN_SHARE_OF_CHARGES,
  USAGE_BILL_DAY_SPREAD,
  USAGE_BILL_MIN_CHARGES,
  SHORT_RUN_CATEGORIES,
  SEMIANNUAL_SHORT_RUN_CATEGORIES,
  SHORT_RUN_MIN_CHARGES,
  SUBSCRIPTION_MERCHANTS,
  TWIN_PLAN_MIN_MONTHS,
  PRICE_PLANS_FREQUENCIES,
  PRICE_PLANS_MIN,
  VARIABLE_BILL_CATEGORIES,
  HIGH_CONFIDENCE_MIN_CHARGES,
  YEARLY_PLAN_GOODS_WORDS,
  YEARLY_PLAN_MAX_CENTS,
  YEARLY_PLAN_MIN_CENTS,
  YEARLY_PLAN_WORDS,
  YEARLY_RENEWAL_WORDS,
  YEARLY_SWITCH_MAX_MONTHS,
  YEARLY_SWITCH_MIN_MONTHS,
  FOUR_WEEKLY_CHARGES_PER_YEAR,
  FOUR_WEEKLY_GAP_DAYS,
  FOUR_WEEKLY_MIN_GAPS,
  SHORT_RUN_FREQUENCIES,
  PAUSE_GAP_MULTIPLE,
  PAUSE_MAX_SKIPPED,
  PAUSE_MIN_REGULAR_GAPS,
  FIXED_PRICE_SUBSCRIPTION_MAX_STEP,
  SUBSCRIPTION_BOX_MERCHANTS,
  PLAN_DESCRIPTION_WORDS,
  PLAN_NAME_PLUS,
  type ConfidenceLevel,
  type Frequency,
} from "@/config/detection";
import { OLD_UPLOAD_DAYS } from "@/config/import";
import { normalizeMerchant } from "@/data-sources/merchant";
import { byDate, inList, inLookback, merchantMatches } from "./helpers";
import type { DetectionInput, DetectionRecurringStream, DetectionTransaction } from "./types";
import { addDays, average, dayOfMonth, daysBetween, firstOfMonth, median } from "./units";

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

export function merchantOf(t: Pick<DetectionTransaction, "merchantName" | "description">) {
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

// A box sold by subscription (SUBSCRIPTION_BOX_MERCHANTS), by its merchant or its charges' words:
// the merchant name drops a word with a digit ("FACTOR75 MEALS" is "meals").
export function isSubscriptionBox(stream: Stream): boolean {
  return (
    merchantMatches(stream.merchantKey, SUBSCRIPTION_BOX_MERCHANTS) ||
    stream.charges.some((c) =>
      merchantMatches(wordsOf(c.description).join(" "), SUBSCRIPTION_BOX_MERCHANTS),
    )
  );
}

// Every four weeks to the day, not monthly: FOUR_WEEKLY_*.
function fourWeekly(run: DetectionTransaction[], frequency: Frequency | null): boolean {
  const gaps = run.slice(1).map((c, i) => daysBetween(run[i].date, c.date));
  return (
    frequency === "MONTHLY" &&
    gaps.length >= FOUR_WEEKLY_MIN_GAPS &&
    gaps.every((gap) => gap === FOUR_WEEKLY_GAP_DAYS)
  );
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
  // Or with a beat skipped (PAUSE_*): a gap of about two intervals among regular ones.
  for (const [frequency, [min, max]] of Object.entries(FALLBACK_INTERVAL_DAYS)) {
    const regular = gaps.filter((gap) => gap >= min && gap <= max).length;
    const skipped = gaps.filter(
      (gap) => gap >= PAUSE_GAP_MULTIPLE * min && gap <= PAUSE_GAP_MULTIPLE * max,
    ).length;
    if (
      skipped > 0 &&
      skipped <= PAUSE_MAX_SKIPPED &&
      regular >= PAUSE_MIN_REGULAR_GAPS &&
      regular + skipped === gaps.length
    ) {
      return frequency as Frequency;
    }
  }
  return null;
}

function withinTolerance(amount: number, reference: number): boolean {
  return Math.abs(amount - reference) <= reference * FALLBACK_AMOUNT_TOLERANCE;
}

// One charge in each month, on about the same day, with no category: a usage bill by its shape.
function usageBillShape(charges: DetectionTransaction[]): boolean {
  if (charges.length < USAGE_BILL_MIN_CHARGES || charges.some((c) => c.pfcDetailed !== null)) {
    return false;
  }
  if (new Set(charges.map((c) => firstOfMonth(c.date))).size !== charges.length) return false;
  // A bill moves with use, but never to a year's worth of itself: that's a plan gone yearly.
  const amounts = charges.map((c) => c.amountCents);
  if (Math.max(...amounts) >= Math.min(...amounts) * YEARLY_SWITCH_MIN_MONTHS) return false;
  const days = charges.map((c) => dayOfMonth(c.date));
  return Math.max(...days) - Math.min(...days) <= USAGE_BILL_DAY_SPREAD;
}

const isVariable = (charges: DetectionTransaction[]) =>
  inList(mostCommon(charges.map((c) => c.pfcDetailed)), VARIABLE_BILL_CATEGORIES) ||
  usageBillShape(charges);

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
  const allowed = shortRunAllowed(charges);
  if (core.length < SHORT_RUN_MIN_CHARGES) return null;

  const gaps = core.slice(1).map((c, i) => daysBetween(core[i].date, c.date));
  const frequency = frequencyOf(gaps);
  const range = frequency && FALLBACK_INTERVAL_DAYS[frequency];
  if (!frequency || !range) return null;
  // Two charges are only a run a month or a quarter apart (SHORT_RUN_FREQUENCIES), or six months
  // apart for a fixed insurance premium (SEMIANNUAL_SHORT_RUN_CATEGORIES).
  const semiannualPremium =
    frequency === "SEMIANNUALLY" &&
    !variable &&
    inList(mostCommon(charges.map((c) => c.pfcDetailed)), SEMIANNUAL_SHORT_RUN_CATEGORIES);
  if (short && !SHORT_RUN_FREQUENCIES.includes(frequency) && !semiannualPremium) return null;
  const [min, max] = range;

  const run = [...core];
  for (const charge of charges) {
    const last = run[run.length - 1];
    if (charge.date <= last.date) continue;
    const gap = daysBetween(last.date, charge.date);
    // A new price, but not a year's worth of the old one: that's the plan switched to yearly.
    const firstNewPrice =
      run.length === core.length &&
      charge.amountCents < last.amountCents * YEARLY_SWITCH_MIN_MONTHS;
    if (
      gap >= min &&
      gap <= max &&
      (variable || firstNewPrice || withinTolerance(charge.amountCents, last.amountCents))
    ) {
      run.push(charge);
    }
  }

  // And before it: once the new price has come more often than the old, the typical amount is
  // the new one, and the charges at the old price, at the same gap, are the run's oldest (CSV
  // bench: Disney+ $13.99, $13.99, $15.99, $15.99, $15.99 was no price increase).
  for (const charge of [...charges].reverse()) {
    const first = run[0];
    if (charge.date >= first.date) continue;
    const gap = daysBetween(charge.date, first.date);
    const firstOldPrice = run[0] === core[0];
    if (
      gap >= min &&
      gap <= max &&
      (variable || firstOldPrice || withinTolerance(charge.amountCents, first.amountCents))
    ) {
      run.unshift(charge);
    }
  }

  // Two at one price are a run only where a repeat can only be a bill or a plan
  // (SHORT_RUN_CATEGORIES), or when a third came at the same gap one step up: a plan whose price
  // rose, seen three times (CSV bench, second tuning set: Xbox Game Pass $16.99, $16.99, $19.99).
  // Every charge at the merchant is one of the run's: a shop's would have others.
  const rose =
    run.length >= FALLBACK_MIN_CHARGES &&
    run.length === charges.length &&
    run
      .slice(core.length)
      .every(
        (c) =>
          c.amountCents > core[0].amountCents &&
          c.amountCents <= core[0].amountCents * (1 + FIXED_PRICE_SUBSCRIPTION_MAX_STEP),
      );
  if (short && !allowed && !rose) return null;

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
    annualCostCents: fourWeekly(run, frequency)
      ? last.amountCents * FOUR_WEEKLY_CHARGES_PER_YEAR
      : annualCost(last.amountCents, frequency),
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

// A monthly plan that ended, then one charge after it worth YEARLY_SWITCH_*_MONTHS of it: the
// plan, now paid by the year.
function switchedToYearly(main: Stream, charges: DetectionTransaction[]): Stream | null {
  if (main.active || main.frequency !== "MONTHLY" || main.lastDate === null) return null;
  const ended = main.lastDate;
  const after = charges.filter((c) => c.date > ended);
  if (after.length !== 1) return null;
  const [plan] = after;
  const months = plan.amountCents / main.lastAmountCents;
  const merchant = merchantOf(plan);
  if (!merchant || months < YEARLY_SWITCH_MIN_MONTHS || months > YEARLY_SWITCH_MAX_MONTHS) {
    return null;
  }
  return { ...yearlyStream(plan, merchant), key: `merchant:${merchant.key}@yearly` };
}

// One charge that is a year of a plan: in YEARLY_PLAN_*_CENTS, under the plan's own name or
// saying it renews the year, and not something from the company's shop. The one rule for a plan
// paid once a year: detection's yearly streams and the price rises (src/planning/price-rises.ts)
// both use it, so a movie ticket or a campus bookstore receipt is never a "renews" card. Says
// what it saw (src/config/evidence.ts): the bank's words, or the plan's own name; null if neither.
export function yearlyPlanEvidence(
  c: Pick<DetectionTransaction, "amountCents" | "description" | "merchantName">,
): "word" | "known_merchant" | null {
  if (c.amountCents < YEARLY_PLAN_MIN_CENTS || c.amountCents > YEARLY_PLAN_MAX_CENTS) return null;
  const merchant = merchantOf(c);
  if (!merchant || isGoods(c.description)) return null;
  if (wordsOf(c.description).some((w) => YEARLY_RENEWAL_WORDS.includes(w))) return "word";
  return isPlanName(merchant.key) || planAfterStar(c.description) ? "known_merchant" : null;
}

export const isYearlyPlanCharge = (
  c: Pick<DetectionTransaction, "amountCents" | "description" | "merchantName">,
) => yearlyPlanEvidence(c) !== null;

// A yearly plan seen once: one charge in YEARLY_PLAN_*_CENTS, and that one a plan's.
function yearlyPlan(charges: DetectionTransaction[]): Stream | null {
  const plans = charges.filter(
    (c) => c.amountCents >= YEARLY_PLAN_MIN_CENTS && c.amountCents <= YEARLY_PLAN_MAX_CENTS,
  );
  const merchant = plans.length === 1 ? merchantOf(plans[0]) : null;
  if (!merchant || !isYearlyPlanCharge(plans[0])) return null;
  return yearlyStream(plans[0], merchant);
}

function yearlyStream(
  plan: DetectionTransaction,
  merchant: NonNullable<ReturnType<typeof merchantOf>>,
): Stream {
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
// The same price twice on one day, month after month: the days' second charges (TWIN_PLAN_*).
export function twinCharges(charges: readonly DetectionTransaction[]): Set<string> | null {
  const seen = new Map<string, DetectionTransaction>();
  const second = new Set<string>();
  const months = new Set<string>();
  for (const c of [...charges].sort(byDate)) {
    const at = `${c.accountId}|${c.date}|${c.amountCents}`;
    if (seen.has(at)) {
      second.add(c.id);
      months.add(firstOfMonth(c.date));
    } else seen.set(at, c);
  }
  return months.size >= TWIN_PLAN_MIN_MONTHS ? second : null;
}

// Two plans billed together: each its own run, the second keyed apart ("merchant:spotify@second").
function twinPlans(charges: DetectionTransaction[], asOf: string): Stream[] | null {
  const second = twinCharges(charges);
  if (!second) return null;
  const a = detectRun(
    charges.filter((c) => !second.has(c.id)),
    asOf,
  );
  const b = detectRun(
    charges.filter((c) => second.has(c.id)),
    asOf,
  );
  if (!a || !b) return null;
  return [a, { ...b, key: `${b.key}@second`, merchant: `${b.merchant} (second plan)` }];
}

// Each exact price that comes regularly, a run of its own; every run after the first keeps the
// merchant's key with its price ("merchant:apple@1099").
function runsByPrice(charges: DetectionTransaction[], asOf: string): Stream[] {
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

const PLAN_WORDS = new RegExp(
  `(?<![A-Z0-9])(?:${PLAN_DESCRIPTION_WORDS.map((w) => w.replace(/[*+]/g, "\\$&")).join("|")})(?![A-Z0-9])`,
);
// A charge that says it's a plan: a membership word, or a name ending in "+" (PLAN_DESCRIPTION_*).
export function saysPlan(description: string): boolean {
  const text = description.toUpperCase();
  return PLAN_WORDS.test(text) || PLAN_NAME_PLUS.test(text);
}

function detectRuns(charges: DetectionTransaction[], asOf: string): Stream[] {
  const key = merchantOf(charges[charges.length - 1])?.key ?? "";
  if (merchantMatches(key, BILLING_PLATFORM_MERCHANTS)) return runsByPrice(charges, asOf);
  // A membership at a company that sells something else ("UBER *ONE MEMBERSHIP" among the rides):
  // its charges are a run of their own (CSV bench, second tuning set). Not when the rest are
  // mostly at the plan's prices: that is the plan written another way ("NAME" and "NAME
  // SUBSCRIPTION").
  const said = charges.filter((c) => saysPlan(c.description));
  const others = charges.filter((c) => !saysPlan(c.description));
  const planPrices = new Set(said.map((c) => c.amountCents));
  const atPlanPrices = others.filter((c) => planPrices.has(c.amountCents)).length;
  if (
    said.length > 0 &&
    others.length > 0 &&
    atPlanPrices < others.length * RUN_MIN_SHARE_OF_CHARGES
  ) {
    const plan = detectRun(said, asOf);
    const rest = detectRuns(others, asOf);
    return plan ? [{ ...plan, key: `${plan.key}@plan` }, ...rest] : rest;
  }
  const twins = twinPlans(charges, asOf);
  if (twins) return twins;
  const main = detectRun(charges, asOf);
  // Two plans from one company at two prices, each every month (Spotify $11.99 and $16.99): the
  // typical amount falls between them, so neither is a run of the whole; each price is one (QA
  // round 30: both were missing from /subscriptions). Only when two or more prices come regularly,
  // and they hold more charges than the run of the whole: when one plan has most of the charges,
  // the run is that plan alone (CSV bench, second tuning set: Google One at $2.99 and $9.99, the
  // $2.99 one lost). A price rise stays one run: its run already holds the new price.
  const plans = isVariable(charges) ? [] : runsByPrice(charges, asOf);
  const held = plans.reduce((n, p) => n + p.charges.length, 0);
  if (
    plans.length >= PRICE_PLANS_MIN &&
    plans.every((p) => p.frequency !== null && PRICE_PLANS_FREQUENCIES.includes(p.frequency)) &&
    held >= charges.length * RUN_MIN_SHARE_OF_CHARGES &&
    held > (main?.charges.length ?? 0)
  ) {
    return plans;
  }
  if (
    main &&
    (isVariable(charges) || main.charges.length >= charges.length * RUN_MIN_SHARE_OF_CHARGES)
  ) {
    const switched = isVariable(charges) ? null : switchedToYearly(main, charges);
    return switched ? [main, switched] : [main];
  }
  // One service paid from two accounts on their own days (two people's plans, on two cards): each
  // account's charges are a run, though together they come at no one gap (CSV bench, second
  // tuning set). The first keeps the merchant's key; the others are numbered.
  const accounts = [...new Set(charges.map((c) => c.accountId))];
  if (accounts.length > 1) {
    const perAccount = accounts.flatMap((a) => {
      const run = detectRun(
        charges.filter((c) => c.accountId === a),
        asOf,
      );
      return run ? [run] : [];
    });
    if (perAccount.length === accounts.length) {
      return perAccount.map((run, i) => (i === 0 ? run : { ...run, key: `${run.key}@${i + 1}` }));
    }
  }
  const plan = yearlyPlan(charges);
  return plan ? [plan] : [];
}

// Whether `long` is `short` with words added at the end, or with one more word inside after the
// first ("directv stream seattle" and "directv seattle", where a card wrote the city after it).
function extends_(short: string, long: string): boolean {
  if (long.startsWith(`${short} `)) return true;
  const a = short.split(" ");
  const b = long.split(" ");
  if (b.length !== a.length + 1 || a[0] !== b[0]) return false;
  return b.some((_, i) => i > 0 && [...b.slice(0, i), ...b.slice(i + 1)].join(" ") === short);
}

// One service written two ways from month to month, its name and its website ("DIRECTV STREAM",
// "DIRECTV.COM"), is one merchant: a key that another extends, on the same accounts, with every
// charge at a price the other also charges (CSV bench: a subscription no rule knows by
// name counted as two, so neither was a bill). Not for app stores, which bill many things at many
// prices.
function joinVariants(groups: Map<string, DetectionTransaction[]>) {
  const accounts = (rows: DetectionTransaction[]) => new Set(rows.map((r) => r.accountId));
  for (const short of [...groups.keys()].sort((a, b) => a.length - b.length)) {
    const base = groups.get(short);
    if (!base || merchantMatches(short, BILLING_PLATFORM_MERCHANTS)) continue;
    for (const long of [...groups.keys()]) {
      const rows = groups.get(long)!;
      if (long === short || !extends_(short, long)) continue;
      const prices: Set<number> = new Set(base.map((r) => r.amountCents));
      const where = accounts(base);
      if (
        rows.every((r) => prices.has(r.amountCents) && where.has(r.accountId)) ||
        base.every(
          (r) =>
            new Set(rows.map((x) => x.amountCents)).has(r.amountCents) &&
            accounts(rows).has(r.accountId),
        )
      ) {
        groups.set(short, [...base, ...rows]);
        groups.delete(long);
      }
    }
  }
}

export function detectRecurring(input: DetectionInput): Stream[] {
  const groups = new Map<string, DetectionTransaction[]>();
  for (const t of inLookback(input)) {
    if (t.amountCents <= 0) continue;
    const key = merchantOf(t)?.key;
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  joinVariants(groups);
  const seenThrough = uploadedThrough(input);
  return [...groups.keys()]
    .sort()
    .flatMap((key) => detectRuns((groups.get(key) ?? []).sort(byDate), input.asOf))
    .map((s) => stillActiveInFile(s, s.accountId ? seenThrough.get(s.accountId) : undefined));
}

// An uploaded account's transactions stop where its file stops: the day of its latest one, but
// never more than OLD_UPLOAD_DAYS before today (older files get /import's "these files are
// old" hint, and their charges are judged against today). A linked account's are current to
// today, so it has none here.
function uploadedThrough(input: DetectionInput): Map<string, string> {
  const linked = new Set(
    input.transactions.filter((t) => t.plaidTransactionId).map((t) => t.accountId),
  );
  const oldest = addDays(input.asOf, -OLD_UPLOAD_DAYS);
  const through = new Map<string, string>();
  for (const t of input.transactions) {
    if (linked.has(t.accountId) || t.date < oldest || t.date > input.asOf) continue;
    if (t.date > (through.get(t.accountId) ?? "")) through.set(t.accountId, t.date);
  }
  return through;
}

// A charge due after the file ends can't have been missed yet: in an uploaded account a stream
// is active while its last charge is within ACTIVE_WITHIN_INTERVALS gaps of the file's last
// day, not of today (night QA 10-30: a card statement to Sep 30 uploaded on Oct 30 found
// nothing, its Hulu, Peacock and gym all "stopped" since their Oct charges weren't in it).
function stillActiveInFile(s: Stream, through: string | undefined): Stream {
  if (s.active || !through || s.lastDate === null) return s;
  const gaps = s.charges.slice(1).map((c, i) => daysBetween(s.charges[i].date, c.date));
  if (gaps.length === 0) return s;
  return {
    ...s,
    active: daysBetween(s.lastDate, through) <= median(gaps) * ACTIVE_WITHIN_INTERVALS,
  };
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
