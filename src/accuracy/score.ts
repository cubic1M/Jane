import { cardPaymentOutflows } from "@/categorize/card-payments";
import { categorizeByRules } from "@/categorize/rules";
import { normalizeMerchant } from "@/data-sources/merchant";
import { detect } from "@/detection/detect";
import { upcomingBills } from "@/detection/forecast";
import { recurringCharges } from "@/detection/subscriptions";
import type { Candidate, DetectionInput } from "@/detection/types";
import { runDetectors } from "@/detectors";
import { kindOf, type InsightTransaction } from "@/insights/spending";
import { buildProfile, type ProfileInput } from "@/profile/build";
import type { History, Labels } from "./generate";

// The accuracy bench's scoring (founder, 2026-10-26): every detector run on the labelled
// histories (./generate.ts), counted item by item against the truth. Pure and database-free, so
// the CI gate (./accuracy.test.ts) and `npm run accuracy` share it.

export const DETECTOR_NAMES = [
  "subscriptions",
  "price_rises",
  "fees",
  "double_charges",
  "idle_cash",
  "card_interest",
  "bills",
  "income",
  "transfers",
] as const;
export type DetectorName = (typeof DETECTOR_NAMES)[number];

export type Counts = { tp: number; fp: number; fn: number; peopleWithFalseAlarm: number };
export type Score = Counts & { precision: number; recall: number; falseAlarmRate: number };

// --- The pipeline, as the CSV import and the engine run it --------------------------------

type Categorized = History["rows"][number] & {
  merchantName: string | null;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
};

// The keyword rules, then the card payments matched from the card's side, as an import does.
function categorized(h: History): Categorized[] {
  const rows = h.rows.map((row) => {
    const category = categorizeByRules({
      description: row.description,
      amountCents: row.amountCents,
      hints: { bankCategory: row.bankCategory, bankType: row.bankType },
    });
    return {
      ...row,
      merchantName: normalizeMerchant(row.description)?.name ?? null,
      pfcPrimary: category?.primary ?? null,
      pfcDetailed: category?.detailed ?? null,
    };
  });
  const paid = new Set(cardPaymentOutflows(rows, h.accounts));
  return rows.map((r) =>
    paid.has(r.id)
      ? { ...r, pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }
      : r,
  );
}

export function detectionInputOf(h: History): DetectionInput {
  return {
    asOf: h.asOf,
    accounts: h.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      currentBalanceCents: a.balanceCents,
    })),
    transactions: categorized(h).map((t) => ({
      id: t.id,
      accountId: t.accountId,
      plaidTransactionId: null,
      date: t.date,
      amountCents: t.amountCents,
      description: t.description,
      merchantName: t.merchantName,
      pfcPrimary: t.pfcPrimary,
      pfcDetailed: t.pfcDetailed,
      categorySource: t.pfcDetailed ? "rule" : null,
    })),
    recurringStreams: [],
  };
}

export function profileInputOf(h: History): ProfileInput {
  return {
    today: h.asOf,
    transactions: categorized(h).map((t) => ({
      date: t.date,
      amountCents: t.amountCents,
      description: t.description,
      pfc: t.pfcDetailed,
      accountId: t.accountId,
    })),
    accounts: h.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      balanceCents: a.balanceCents,
    })),
    liabilities: [],
    told: {},
  };
}

// --- What each detector says, as sets of item ids ------------------------------------------

const after = (prefix: string, key: string) =>
  key.startsWith(prefix) ? key.slice(prefix.length) : key;
// A stream's merchant: "merchant:apple@1099", a second subscription billed through Apple, is Apple.
const merchantIn = (key: string) => after("merchant:", key).split("@")[0];
const keysOf = (findings: Candidate[], type: Candidate["type"], prefix: string) =>
  findings.filter((f) => f.type === type).map((f) => after(prefix, f.key));

export type Predicted = Record<DetectorName, string[]>;

export function predict(h: History): { predicted: Predicted; findings: Candidate[] } {
  const input = detectionInputOf(h);
  const findings = detect(input);
  const insight = (t: DetectionInput["transactions"][number]): InsightTransaction => ({
    ...t,
    pending: false,
  });
  const moving = input.transactions.filter((t) => {
    const kind = kindOf(insight(t));
    return kind === "ignored" && t.pfcPrimary !== "INCOME";
  });
  return {
    findings,
    predicted: {
      subscriptions: recurringCharges(input)
        .filter((c) => c.subscription)
        .map((c) => c.merchantKey),
      price_rises: keysOf(findings, "price_increase", "merchant:").map(merchantIn),
      fees: keysOf(findings, "bank_fees", "account:"),
      double_charges: keysOf(findings, "duplicate_charge", "transaction:"),
      idle_cash: findings.some((f) => f.type === "idle_cash") ? [h.id] : [],
      card_interest: keysOf(findings, "card_interest", "account:"),
      bills: [
        ...new Set(
          upcomingBills(input, 31).map((b) => normalizeMerchant(b.merchant)?.key ?? b.merchant),
        ),
      ],
      income: input.transactions.filter((t) => kindOf(insight(t)) === "income").map((t) => t.id),
      transfers: moving.map((t) => t.id),
    },
  };
}

export function truth(h: History): Record<DetectorName, string[]> {
  const l: Labels = h.labels;
  return {
    subscriptions: l.subscriptions,
    price_rises: l.priceRises,
    fees: l.feeAccounts,
    double_charges: l.duplicates,
    idle_cash: l.idleCash ? [h.id] : [],
    card_interest: l.interestAccounts,
    bills: l.bills,
    income: l.income,
    transfers: l.transfers,
  };
}

// --- Scores --------------------------------------------------------------------------------

const ratio = (num: number, den: number) => (den === 0 ? 1 : num / den);

export function scoreOf(c: Counts, people: number): Score {
  return {
    ...c,
    precision: ratio(c.tp, c.tp + c.fp),
    recall: ratio(c.tp, c.tp + c.fn),
    falseAlarmRate: c.peopleWithFalseAlarm / Math.max(1, people),
  };
}

export type Mistake = { person: string; detector: DetectorName; kind: "fp" | "fn"; item: string };

export function scoreboard(histories: readonly History[]): {
  scores: Record<DetectorName, Score>;
  mistakes: Mistake[];
} {
  const counts = Object.fromEntries(
    DETECTOR_NAMES.map((d) => [d, { tp: 0, fp: 0, fn: 0, peopleWithFalseAlarm: 0 }]),
  ) as Record<DetectorName, Counts>;
  const mistakes: Mistake[] = [];
  for (const h of histories) {
    const { predicted } = predict(h);
    const real = truth(h);
    for (const d of DETECTOR_NAMES) {
      const said = new Set(predicted[d]);
      const is = new Set(real[d]);
      const c = counts[d];
      let falseAlarm = false;
      for (const item of said) {
        if (is.has(item)) c.tp += 1;
        else {
          c.fp += 1;
          falseAlarm = true;
          mistakes.push({ person: h.id, detector: d, kind: "fp", item });
        }
      }
      for (const item of is) {
        if (!said.has(item)) {
          c.fn += 1;
          mistakes.push({ person: h.id, detector: d, kind: "fn", item });
        }
      }
      if (falseAlarm) c.peopleWithFalseAlarm += 1;
    }
  }
  const scores = Object.fromEntries(
    DETECTOR_NAMES.map((d) => [d, scoreOf(counts[d], histories.length)]),
  ) as Record<DetectorName, Score>;
  return { scores, mistakes };
}

// --- Calibration: is "80% sure" right 80% of the time? --------------------------------------

// Whether a suggestion's topic is true of the person, for the topics the labels can answer.
// Topics the labels say nothing about are left out of calibration.
const TOPIC_TRUTH: Record<string, (h: History) => boolean> = {
  subscriptions: (h) => h.labels.subscriptions.length > 0,
  price_increase: (h) => h.labels.priceRises.length > 0,
  bank_fees: (h) => h.labels.feeAccounts.length > 0,
  duplicate_charge: (h) => h.labels.duplicates.length > 0,
  card_interest: (h) => h.labels.interestAccounts.length > 0,
  idle_cash: (h) => h.labels.idleCash,
  emergency_fund: (h) => !h.labels.idleCash,
};
export const CALIBRATED_TOPICS = Object.keys(TOPIC_TRUTH);

export type Judged = { person: string; topic: string; percent: number; right: boolean };

export function judgedSuggestions(histories: readonly History[]): Judged[] {
  return histories.flatMap((h) => {
    const data = profileInputOf(h);
    return runDetectors({ profile: buildProfile(data), data }).flatMap((s) => {
      const isTrue = TOPIC_TRUTH[s.topic];
      return isTrue
        ? [{ person: h.id, topic: s.topic, percent: s.confidence.percent, right: isTrue(h) }]
        : [];
    });
  });
}

export const BUCKETS = [
  [0, 49],
  [50, 59],
  [60, 69],
  [70, 79],
  [80, 89],
  [90, 100],
] as const;

export type Bucket = {
  from: number;
  to: number;
  count: number;
  saidPercent: number;
  rightPercent: number;
};

export function calibration(judged: readonly Judged[]): Bucket[] {
  return BUCKETS.map(([from, to]) => {
    const inside = judged.filter((j) => j.percent >= from && j.percent <= to);
    const n = inside.length;
    return {
      from,
      to,
      count: n,
      saidPercent: n ? Math.round(inside.reduce((s, j) => s + j.percent, 0) / n) : 0,
      rightPercent: n ? Math.round((100 * inside.filter((j) => j.right).length) / n) : 0,
    };
  });
}

// The finding cards' own levels, and how often each is right.
export function levels(
  histories: readonly History[],
): Record<string, { count: number; right: number }> {
  const out: Record<string, { count: number; right: number }> = {};
  const truthFor: Partial<Record<Candidate["type"], (h: History, f: Candidate) => boolean>> = {
    subscription_review: (h, f) => h.labels.subscriptions.includes(merchantIn(f.key)),
    price_increase: (h, f) => h.labels.priceRises.includes(merchantIn(f.key)),
    bank_fees: (h, f) => h.labels.feeAccounts.includes(after("account:", f.key)),
    duplicate_charge: (h, f) => h.labels.duplicates.includes(after("transaction:", f.key)),
    idle_cash: (h) => h.labels.idleCash,
    card_interest: (h, f) => h.labels.interestAccounts.includes(after("account:", f.key)),
  };
  for (const h of histories) {
    for (const f of predict(h).findings) {
      const isTrue = truthFor[f.type];
      if (!isTrue) continue;
      const row = (out[f.confidence] ??= { count: 0, right: 0 });
      row.count += 1;
      if (isTrue(h, f)) row.right += 1;
    }
  }
  return out;
}
