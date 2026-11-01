import {
  CONFIRMED_SHARE,
  FEE_COMPARE_DAYS,
  HELD_DAYS,
  LOWER_BILL_SHARE,
  REFUND_MIN_SHARE,
  SAME_CHARGE_SHARE,
  STOP_GRACE_DAYS,
  VERIFIED_PERCENT,
  WATCH_DAYS,
} from "@/config/outcomes";
import { normalizeMerchant } from "@/data-sources/merchant";
import type { TransactionWatch, Watch } from "@/detectors/contract";
import { addDays } from "@/detection/units";
import { formatCents } from "@/lib/money";
import { DAY_MS } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";

// Whether a suggestion the person acted on shows in their later transactions (the verified
// savings record). Pure: the watch the detector left, the day the person acted, today, what
// was expected and the transactions in; what they show out, with the transactions that show it.
// "waiting" until there's enough to tell either way.
//
// A charge that "stopped" or fees that "stopped" are an absence, so they count only up to the
// day the person's statements reach (coveredThrough, per account: the newest transaction, upload
// or bank sync). Without a newer statement, nothing is verified.

export type OutcomeTx = {
  id: string;
  date: string;
  amountCents: number;
  description: string;
  pfc: string | null;
  accountId?: string;
};

// Per account, the last day its statements reach (YYYY-MM-DD).
export type Coverage = Readonly<Record<string, string>>;

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

// Confirmed when the transactions show most of what was expected; partial when some.
const verdict = (cents: number, expectedCents: number): "confirmed" | "partial" =>
  cents >= expectedCents * CONFIRMED_SHARE ? "confirmed" : "partial";
const minDay = (a: string, b: string) => (a < b ? a : b);
const sentence = (parts: string[]) => `${parts.join("; ")}.`.replace(/^./, (c) => c.toUpperCase());

// How far the statements reach for an account, never past today. Without coverage given (older
// callers), today; with it, an account it doesn't know reaches nowhere after the day acted.
function reachOf(coveredThrough: Coverage | undefined, asOf: string, fallback: string) {
  return (accountId: string | undefined) =>
    !coveredThrough || !accountId ? asOf : minDay(asOf, coveredThrough[accountId] ?? fallback);
}

const chargesFrom = (transactions: readonly OutcomeTx[]) => {
  const charges = transactions.filter((t) => t.amountCents > 0);
  return (description: string) => {
    const key = keyOf(description);
    return charges
      .filter((t) => keyOf(t.description) === key)
      .sort((a, b) => a.date.localeCompare(b.date));
  };
};

// Fees: how far the statements reach on every account the fees were charged to.
function feeReach(
  watch: Extract<TransactionWatch, { kind: "fee_stops" }>,
  transactions: readonly OutcomeTx[],
  reach: (accountId: string | undefined) => string,
  asOf: string,
) {
  const accounts = [
    ...new Set(
      transactions
        .filter((t) => t.amountCents > 0 && watch.pfcs.includes(t.pfc ?? "") && t.accountId)
        .map((t) => t.accountId!),
    ),
  ];
  return accounts.length === 0 ? asOf : accounts.map(reach).reduce(minDay);
}

export function verifyWatch(
  watch: TransactionWatch,
  {
    startedOn,
    asOf,
    expectedCents,
    coveredThrough,
  }: { startedOn: string; asOf: string; expectedCents: number; coveredThrough?: Coverage },
  transactions: readonly OutcomeTx[],
): Check {
  const over = daysBetween(startedOn, asOf) > WATCH_DAYS[watch.kind];
  const charges = transactions.filter((t) => t.amountCents > 0);
  const from = chargesFrom(transactions);
  const reach = reachOf(coveredThrough, asOf, startedOn);

  if (watch.kind === "charge_stops") {
    let cents = 0;
    let twice = true;
    const evidence: string[] = [];
    const proofs: string[] = [];
    const still: OutcomeTx[] = [];
    let pending = false;
    // Due and gone, but no statement after it yet.
    const unread: string[] = [];
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
      const seenTo = reach(last.accountId);
      if (seenTo <= addDays(due, STOP_GRACE_DAYS)) {
        pending = true;
        if (asOf > addDays(due, STOP_GRACE_DAYS)) unread.push(due);
        continue;
      }
      if (seenTo <= addDays(due, interval + STOP_GRACE_DAYS)) twice = false;
      cents += p.amountCents * p.perYear;
      evidence.push(last.id);
      proofs.push(
        `last charged ${formatCents(last.amountCents)} on ${dayLabel(last.date)}, nothing since, though the next was due ${dayLabel(due)}`,
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
            ? `Still charged: ${still.map((t) => `${formatCents(t.amountCents)} on ${dayLabel(t.date)}`).join(", ")}.`
            : unread.length > 0
              ? `No statement after ${dayLabel(unread[0])}, when the next charge was due, to check it against.`
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
          `the bill came in at ${formatCents(lower.amountCents)} on ${dayLabel(lower.date)}, down from ${formatCents(p.beforeCents)}`,
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
            ? `Still billed in full: ${full.map((t) => `${formatCents(t.amountCents)} on ${dayLabel(t.date)}`).join(", ")}.`
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
      proofs.push(`${formatCents(-back.amountCents)} came back on ${dayLabel(back.date)}`);
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

  // Fees that should stop: the FEE_COMPARE_DAYS after acting against the month before, once the
  // statements reach the end of them.
  const end = addDays(startedOn, FEE_COMPARE_DAYS);
  if (asOf < end) return { status: "waiting" };
  if (feeReach(watch, transactions, reach, asOf) < end) {
    return over
      ? {
          status: "not_seen",
          evidence: [],
          proof: `No statement reaching ${dayLabel(end)} to count the fees against.`,
        }
      : { status: "waiting" };
  }
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

// Held (the ledger's last state): a verified saving still true HELD_DAYS after it was verified,
// on statements that reach that far. "lapsed" as soon as the transactions show it came back (the
// charge is billed again, the bill back up, the refund taken back, the fees back), with the lines
// that show it; "waiting" until then. Pure, like verifyWatch.
export type HeldCheck =
  { status: "waiting" } | { status: "held" | "lapsed"; evidence: string[]; proof: string };

export function checkHeld(
  watch: TransactionWatch,
  {
    startedOn,
    verifiedOn,
    asOf,
    confirmedCents,
    coveredThrough,
  }: {
    startedOn: string;
    verifiedOn: string;
    asOf: string;
    confirmedCents: number;
    coveredThrough?: Coverage;
  },
  transactions: readonly OutcomeTx[],
): HeldCheck {
  const heldOn = addDays(verifiedOn, HELD_DAYS);
  const from = chargesFrom(transactions);
  const reach = reachOf(coveredThrough, asOf, verifiedOn);
  const line = (t: OutcomeTx) => `${formatCents(Math.abs(t.amountCents))} on ${dayLabel(t.date)}`;

  if (watch.kind === "charge_stops") {
    const evidence: string[] = [];
    const proofs: string[] = [];
    let covered = true;
    for (const p of watch.payees) {
      const history = from(p.description);
      const last = history.filter((t) => t.date <= startedOn).at(-1);
      if (!last) continue;
      const came = history.find(
        (t) => t.date > startedOn && t.amountCents >= p.amountCents * SAME_CHARGE_SHARE,
      );
      if (came) {
        return { status: "lapsed", evidence: [came.id], proof: `Charged again: ${line(came)}.` };
      }
      const seenTo = reach(last.accountId);
      if (seenTo < heldOn) covered = false;
      evidence.push(last.id);
      proofs.push(`no charge since ${line(last)}, through ${dayLabel(seenTo)}`);
    }
    if (!covered || evidence.length === 0) return { status: "waiting" };
    return { status: "held", evidence, proof: sentence(proofs) };
  }

  if (watch.kind === "bill_drops") {
    const evidence: string[] = [];
    const proofs: string[] = [];
    let recent = true;
    for (const p of watch.payees) {
      const after = from(p.description).filter((t) => t.date > startedOn);
      const lower = after.find((t) => t.amountCents < p.beforeCents * LOWER_BILL_SHARE);
      if (!lower) continue;
      const since = after.filter((t) => t.date > lower.date);
      const back = since.find((t) => t.amountCents >= p.beforeCents * LOWER_BILL_SHARE);
      if (back) {
        return {
          status: "lapsed",
          evidence: [back.id],
          proof: `The bill went back up: ${line(back)}, against ${formatCents(p.beforeCents)} before.`,
        };
      }
      // The newest bill must be from around the held day: within one billing cycle of it.
      const latest = since.at(-1) ?? lower;
      const cycle = Math.round(365 / p.perYear) + STOP_GRACE_DAYS;
      if (asOf < heldOn || latest.date < addDays(heldOn, -cycle)) recent = false;
      evidence.push(latest.id);
      proofs.push(`still billed ${line(latest)}, down from ${formatCents(p.beforeCents)}`);
    }
    if (!recent || evidence.length === 0) return { status: "waiting" };
    return { status: "held", evidence, proof: sentence(proofs) };
  }

  if (watch.kind === "refund") {
    const evidence: string[] = [];
    const proofs: string[] = [];
    let covered = true;
    for (const p of watch.payees) {
      const key = keyOf(p.description);
      const back = transactions.find(
        (t) =>
          t.amountCents < 0 &&
          t.date >= startedOn &&
          keyOf(t.description) === key &&
          -t.amountCents >= p.amountCents * REFUND_MIN_SHARE,
      );
      if (!back) continue;
      // Taken back: the same amount charged again by them after the refund.
      const reversed = from(p.description).find(
        (t) => t.date > back.date && t.amountCents === -back.amountCents,
      );
      if (reversed) {
        return {
          status: "lapsed",
          evidence: [reversed.id],
          proof: `The refund was taken back: ${line(reversed)}.`,
        };
      }
      if (reach(back.accountId) < heldOn) covered = false;
      evidence.push(back.id);
      proofs.push(`${line(back)} came back and stayed`);
    }
    if (!covered || evidence.length === 0) return { status: "waiting" };
    return { status: "held", evidence, proof: sentence(proofs) };
  }

  // Fees: the HELD_DAYS after verifying, against the month before acting.
  if (feeReach(watch, transactions, reach, asOf) < heldOn) return { status: "waiting" };
  const fees = transactions.filter(
    (t) =>
      t.amountCents > 0 &&
      watch.pfcs.includes(t.pfc ?? "") &&
      t.date > verifiedOn &&
      t.date <= heldOn,
  );
  const monthly = Math.round(
    fees.reduce((s, t) => s + t.amountCents, 0) / (HELD_DAYS / (365 / 12)),
  );
  const savedNow = Math.max(0, watch.monthlyCents - monthly) * 12;
  const words = `${fees.length} fees in the ${HELD_DAYS} days after it was verified, about ${formatCents(monthly)} a month against ${formatCents(watch.monthlyCents)} before.`;
  return {
    status: savedNow >= confirmedCents * CONFIRMED_SHARE ? "held" : "lapsed",
    evidence: fees.map((t) => t.id),
    proof: words,
  };
}

// When a Done saving will be checked (founder, 10-30: "Hulu: done, we'll check on Nov 5"). It is
// still verified only from the next charge or bill after the person acted; this says which day
// that is: the next charge's due day plus the bank's grace, the next bill's, the end of the fee
// window, or for a refund the last day Jane watches for it. The earliest across payees. Null when
// transactions can't say (investing, nothing to watch, no charge before acting). Pure.
export type CheckDay = { on: string; until: boolean };

export function checksOn(
  watch: TransactionWatch,
  startedOn: string,
  transactions: readonly OutcomeTx[],
): CheckDay | null {
  if (watch.kind === "refund") {
    return { on: addDays(startedOn, WATCH_DAYS.refund), until: true };
  }
  if (watch.kind === "fee_stops") {
    return { on: addDays(startedOn, FEE_COMPARE_DAYS), until: false };
  }
  const from = chargesFrom(transactions);
  const days = watch.payees.flatMap((p) => {
    const last = from(p.description)
      .filter((t) => t.date <= startedOn)
      .at(-1);
    if (!last) return [];
    // As verifyWatch counts it: the next one after the last charge before acting.
    const due = addDays(last.date, Math.round(365 / p.perYear));
    return [addDays(due, watch.kind === "charge_stops" ? STOP_GRACE_DAYS + 1 : 0)];
  });
  if (days.length === 0) return null;
  return { on: days.reduce(minDay), until: false };
}

// Whether a saving is a yearly amount: money back comes once, whatever the row says (debugger
// 10-30: a double charge marked done read "about $46.18/yr"); else what was stored.
export function outcomeYearly(watch: unknown, stored: boolean): boolean {
  return asWatch(watch)?.kind === "refund" ? false : stored;
}

// Whether a stored watch has the shape Watch (rows are JSON).
export function asWatch(value: unknown): Watch | null {
  if (!value || typeof value !== "object") return null;
  const w = value as { kind?: unknown; payees?: unknown; pfcs?: unknown; monthlyCents?: unknown };
  if (w.kind === "fee_stops")
    return Array.isArray(w.pfcs) && typeof w.monthlyCents === "number" ? (value as Watch) : null;
  if (w.kind === "charge_stops" || w.kind === "bill_drops" || w.kind === "refund")
    return Array.isArray(w.payees) && w.payees.length > 0 ? (value as Watch) : null;
  const h = value as { funds?: unknown; accounts?: unknown; beforeCents?: unknown };
  if (w.kind === "funds_left")
    return Array.isArray(h.funds) && h.funds.length > 0 ? (value as Watch) : null;
  if (w.kind === "account_closed")
    return Array.isArray(h.accounts) && h.accounts.length > 0 ? (value as Watch) : null;
  if (w.kind === "cash_invested")
    return typeof h.beforeCents === "number" ? (value as Watch) : null;
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
  SEMIANNUALLY: 2,
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
