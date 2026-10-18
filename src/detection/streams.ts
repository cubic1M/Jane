import {
  ACTIVE_WITHIN_INTERVALS,
  CHARGES_PER_YEAR,
  FALLBACK_AMOUNT_TOLERANCE,
  FALLBACK_INTERVAL_DAYS,
  FALLBACK_MIN_CHARGES,
  HIGH_CONFIDENCE_MIN_CHARGES,
  type ConfidenceLevel,
  type Frequency,
} from "@/config/detection";
import { normalizeMerchant } from "@/data-sources/merchant";
import { byDate, inLookback } from "./helpers";
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
};

function merchantOf(t: DetectionTransaction) {
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

function fromPlaid(
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

// Fallback: at one merchant, the charges near the typical amount must come at a regular
// gap. Charges after that run, at the same gap but a new price (within tolerance of each
// other), are kept as the run's newest charges so price increases show up.
function detectRun(charges: DetectionTransaction[], asOf: string): Stream | null {
  const typical = median(charges.map((c) => c.amountCents));
  const core = charges.filter((c) => withinTolerance(c.amountCents, typical));
  if (core.length < FALLBACK_MIN_CHARGES) return null;

  const gaps = core.slice(1).map((c, i) => daysBetween(core[i].date, c.date));
  const frequency = frequencyOf(gaps);
  const range = frequency && FALLBACK_INTERVAL_DAYS[frequency];
  if (!frequency || !range) return null;
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
      (firstNewPrice || withinTolerance(charge.amountCents, last.amountCents))
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
    confidence: run.length >= HIGH_CONFIDENCE_MIN_CHARGES ? "high" : "medium",
  };
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
    .map((key) => detectRun((groups.get(key) ?? []).sort(byDate), input.asOf))
    .filter((s): s is Stream => s !== null);
}

// Outflow streams only (Plaid gives outflows positive amounts, like transactions).
export function buildStreams(input: DetectionInput): Stream[] {
  if (input.recurringStreams.length === 0) return detectRecurring(input);

  const byPlaidId = new Map(
    input.transactions.flatMap((t) => (t.plaidTransactionId ? [[t.plaidTransactionId, t]] : [])),
  );
  return input.recurringStreams
    .filter((s) => s.averageAmountCents > 0)
    .sort((a, b) => a.plaidStreamId.localeCompare(b.plaidStreamId))
    .map((s) => fromPlaid(s, byPlaidId));
}
