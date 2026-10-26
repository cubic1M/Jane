import {
  CONFIRMED_SHARE,
  FEE_COMPARE_DAYS,
  LOWER_BILL_SHARE,
  REFUND_MIN_SHARE,
  SAME_CHARGE_SHARE,
  STOP_GRACE_DAYS,
  VERIFIED_PERCENT,
  WATCH_DAYS,
} from "@/config/outcomes";
import { normalizeMerchant } from "@/data-sources/merchant";
import type { Watch } from "@/detectors/contract";
import { addDays } from "@/detection/units";
import { formatCents } from "@/lib/money";
import { DAY_MS } from "@/lib/dates";

// Whether a suggestion the person acted on shows in their later transactions (the verified
// savings record). Pure: the watch the detector left, the day the person acted, today, what
// was expected and the transactions in; what they show out, with the transactions that show it.
// "waiting" until there's enough to tell either way.

export type OutcomeTx = {
  id: string;
  date: string;
  amountCents: number;
  description: string;
  pfc: string | null;
};

export type Verified = {
  status: "confirmed" | "partial";
  cents: number;
  yearly: boolean;
  percent: number;
  evidence: string[];
  proof: string;
};
export type Check =
  { status: "waiting" } | Verified | { status: "not_seen"; evidence: string[]; proof: string };

const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY_MS;
const keyOf = (description: string) =>
  normalizeMerchant(description)?.key ?? description.trim().toLowerCase();
const short = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

// Confirmed when the transactions show most of what was expected; partial when some.
const verdict = (cents: number, expectedCents: number): "confirmed" | "partial" =>
  cents >= expectedCents * CONFIRMED_SHARE ? "confirmed" : "partial";

export function verifyWatch(
  watch: Watch,
  { startedOn, asOf, expectedCents }: { startedOn: string; asOf: string; expectedCents: number },
  transactions: readonly OutcomeTx[],
): Check {
  const over = daysBetween(startedOn, asOf) > WATCH_DAYS[watch.kind];
  const charges = transactions.filter((t) => t.amountCents > 0);
  const from = (description: string) => {
    const key = keyOf(description);
    return charges
      .filter((t) => keyOf(t.description) === key)
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  if (watch.kind === "charge_stops") {
    let cents = 0;
    let twice = true;
    const evidence: string[] = [];
    const proofs: string[] = [];
    const still: OutcomeTx[] = [];
    let pending = false;
    for (const p of watch.payees) {
      const history = from(p.description);
      const last = history.filter((t) => t.date <= startedOn).at(-1);
      if (!last) continue;
      const came = history.find(
        (t) => t.date > startedOn && t.amountCents >= p.amountCents * SAME_CHARGE_SHARE,
      );
      if (came) {
        still.push(came);
        continue;
      }
      const interval = Math.round(365 / p.perYear);
      const due = addDays(last.date, interval);
      if (asOf <= addDays(due, STOP_GRACE_DAYS)) {
        pending = true;
        continue;
      }
      if (asOf <= addDays(due, interval + STOP_GRACE_DAYS)) twice = false;
      cents += p.amountCents * p.perYear;
      evidence.push(last.id);
      proofs.push(
        `last charged ${formatCents(last.amountCents)} on ${short(last.date)}, nothing since, though the next was due ${short(due)}`,
      );
    }
    if (cents > 0) {
      return {
        status: verdict(cents, expectedCents),
        cents,
        yearly: true,
        percent: twice ? VERIFIED_PERCENT.charge_stopped_twice : VERIFIED_PERCENT.charge_stopped,
        evidence,
        proof: `${proofs.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()),
      };
    }
    if (pending && !over) return { status: "waiting" };
    if (still.length > 0 || over) {
      return {
        status: "not_seen",
        evidence: still.map((t) => t.id),
        proof:
          still.length > 0
            ? `Still charged: ${still.map((t) => `${formatCents(t.amountCents)} on ${short(t.date)}`).join(", ")}.`
            : "No charge to compare with.",
      };
    }
    return { status: "waiting" };
  }

  if (watch.kind === "bill_drops") {
    let cents = 0;
    const evidence: string[] = [];
    const proofs: string[] = [];
    const full: OutcomeTx[] = [];
    for (const p of watch.payees) {
      const after = from(p.description).filter((t) => t.date > startedOn);
      const lower = after.find((t) => t.amountCents < p.beforeCents * LOWER_BILL_SHARE);
      if (lower) {
        cents += (p.beforeCents - lower.amountCents) * p.perYear;
        evidence.push(lower.id);
        proofs.push(
          `the bill came in at ${formatCents(lower.amountCents)} on ${short(lower.date)}, down from ${formatCents(p.beforeCents)}`,
        );
      } else full.push(...after);
    }
    if (cents > 0) {
      return {
        status: verdict(cents, expectedCents),
        cents,
        yearly: true,
        percent: VERIFIED_PERCENT.bill_dropped,
        evidence,
        proof: `${proofs.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()),
      };
    }
    // Two bills at the full price since, or the time is up: it didn't come down.
    if (full.length >= 2 || over) {
      return {
        status: "not_seen",
        evidence: full.map((t) => t.id),
        proof:
          full.length > 0
            ? `Still billed in full: ${full.map((t) => `${formatCents(t.amountCents)} on ${short(t.date)}`).join(", ")}.`
            : "No lower bill came.",
      };
    }
    return { status: "waiting" };
  }

  if (watch.kind === "refund") {
    let cents = 0;
    const evidence: string[] = [];
    const proofs: string[] = [];
    for (const p of watch.payees) {
      const key = keyOf(p.description);
      const back = transactions.find(
        (t) =>
          t.amountCents < 0 &&
          t.date >= startedOn &&
          keyOf(t.description) === key &&
          -t.amountCents >= p.amountCents * REFUND_MIN_SHARE &&
          !evidence.includes(t.id),
      );
      if (!back) continue;
      cents += -back.amountCents;
      evidence.push(back.id);
      proofs.push(`${formatCents(-back.amountCents)} came back on ${short(back.date)}`);
    }
    if (cents > 0) {
      return {
        status: verdict(cents, expectedCents),
        cents,
        yearly: false,
        percent: VERIFIED_PERCENT.refund_seen,
        evidence,
        proof: `${proofs.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()),
      };
    }
    return over
      ? { status: "not_seen", evidence: [], proof: "No refund came back." }
      : { status: "waiting" };
  }

  // Fees that should stop: the FEE_COMPARE_DAYS after acting against the month before.
  const end = addDays(startedOn, FEE_COMPARE_DAYS);
  if (asOf < end) return { status: "waiting" };
  const fees = charges.filter(
    (t) => watch.pfcs.includes(t.pfc ?? "") && t.date > startedOn && t.date <= end,
  );
  const months = FEE_COMPARE_DAYS / (365 / 12);
  const after = Math.round(fees.reduce((s, t) => s + t.amountCents, 0) / months);
  const savedMonthly = Math.max(0, watch.monthlyCents - after);
  if (savedMonthly === 0) {
    return {
      status: "not_seen",
      evidence: fees.map((t) => t.id),
      proof: `${fees.length} fees since, about ${formatCents(after)} a month: no fewer than before.`,
    };
  }
  const cents = savedMonthly * 12;
  return {
    status: verdict(cents, expectedCents),
    cents,
    yearly: true,
    percent: fees.length === 0 ? VERIFIED_PERCENT.fees_stopped : VERIFIED_PERCENT.fees_fewer,
    evidence: fees.map((t) => t.id),
    proof:
      fees.length === 0
        ? `No fees in the ${FEE_COMPARE_DAYS} days since, against about ${formatCents(watch.monthlyCents)} a month before.`
        : `${fees.length} fees in the ${FEE_COMPARE_DAYS} days since, about ${formatCents(after)} a month against ${formatCents(watch.monthlyCents)} before.`,
  };
}

// Whether a stored watch has the shape Watch (rows are JSON).
export function asWatch(value: unknown): Watch | null {
  if (!value || typeof value !== "object") return null;
  const w = value as { kind?: unknown; payees?: unknown; pfcs?: unknown; monthlyCents?: unknown };
  if (w.kind === "fee_stops")
    return Array.isArray(w.pfcs) && typeof w.monthlyCents === "number" ? (value as Watch) : null;
  if (w.kind === "charge_stops" || w.kind === "bill_drops" || w.kind === "refund")
    return Array.isArray(w.payees) && w.payees.length > 0 ? (value as Watch) : null;
  return null;
}

// What to watch for a finding card the person handled themselves ("Mark done" on a
// do-it-yourself card), from the evidence detection kept with it. Null when its saving isn't
// something transactions show (idle cash, a cover the card already has).
type Charge = { description?: unknown; amountCents?: unknown };
type Stream = {
  frequency?: unknown;
  lastAmountCents?: unknown;
  charges?: unknown;
};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const lastOf = (charges: unknown) =>
  Array.isArray(charges) ? (charges.at(-1) as Charge | undefined) : undefined;
const PER_YEAR: Readonly<Record<string, number>> = {
  WEEKLY: 52,
  BIWEEKLY: 26,
  SEMI_MONTHLY: 24,
  MONTHLY: 12,
  QUARTERLY: 4,
  ANNUALLY: 1,
};

function payeeOf(stream: Stream) {
  const last = lastOf(stream.charges);
  const amountCents = num(stream.lastAmountCents) ?? num(last?.amountCents);
  const perYear = PER_YEAR[String(stream.frequency)] ?? null;
  return typeof last?.description === "string" && amountCents !== null && perYear !== null
    ? { description: last.description, amountCents, perYear }
    : null;
}

export function watchOfFinding(type: string, evidence: unknown): Watch | null {
  const e = (evidence ?? {}) as Stream & {
    services?: unknown;
    refundCents?: unknown;
    totalCents?: unknown;
    transactions?: unknown;
  };
  switch (type) {
    case "subscription_review":
    case "trial_conversion": {
      const p = payeeOf(e);
      return p ? { kind: "charge_stops", payees: [p] } : null;
    }
    case "duplicate_subscription": {
      const payees = (Array.isArray(e.services) ? (e.services as Stream[]) : [])
        .map(payeeOf)
        .filter((p): p is NonNullable<typeof p> => p !== null);
      return payees.length > 0 ? { kind: "charge_stops", payees } : null;
    }
    case "price_increase":
    case "bill_negotiation":
    case "insurance_reshop": {
      const p = payeeOf(e);
      return p
        ? {
            kind: "bill_drops",
            payees: [
              { description: p.description, beforeCents: p.amountCents, perYear: p.perYear },
            ],
          }
        : null;
    }
    case "duplicate_charge":
    case "charge_after_cancel": {
      const first = Array.isArray(e.charges) ? (e.charges[0] as Charge | undefined) : undefined;
      const amountCents = num(e.refundCents);
      return typeof first?.description === "string" && amountCents !== null
        ? { kind: "refund", payees: [{ description: first.description, amountCents }] }
        : null;
    }
    case "bank_fees":
    case "card_interest": {
      const total = num(e.totalCents);
      const pfcs = [
        ...new Set(
          (Array.isArray(e.transactions) ? e.transactions : [])
            .map((t) => (t as { category?: unknown }).category)
            .filter((c): c is string => typeof c === "string"),
        ),
      ];
      return total !== null && pfcs.length > 0
        ? { kind: "fee_stops", pfcs, monthlyCents: Math.round(total / 12) }
        : null;
    }
    default:
      return null;
  }
}
