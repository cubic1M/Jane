import { PAYCHECK_LATE_DAYS, PAYCHECK_MIN_HISTORY } from "@/config/changes";
import { LIFE_EVENT_KINDS, type LifeEventKind } from "@/config/life-events";
import {
  BABY_HOSPITAL_MIN_CENTS,
  BABY_HOSPITAL_WORDS,
  BABY_MERCHANTS,
  LIFE_SIGNAL_DAYS,
  LIFE_SIGNALS_NEEDED,
  MOVING_FURNITURE_MIN_CENTS,
  MOVING_MERCHANTS,
  NEW_JOB_PAY_CHANGE_SHARE,
} from "@/config/life-signals";
import { byDate, merchantMatches } from "@/detection/helpers";
import { merchantOf } from "@/detection/streams";
import type { DetectionInput, DetectionTransaction } from "@/detection/types";
import { addDays, daysBetween, median } from "@/detection/units";
import { formatCents } from "@/lib/money";
import { employers } from "./changes";

// Life events spotted (spec step 100): signs in someone's money that they're moving,
// started a new job or have a new baby. Pure: the detection input in, the guesses out. A
// guess needs LIFE_SIGNALS_NEEDED different kinds of signal inside LIFE_SIGNAL_DAYS: one
// signal never asks.

export type LifeSignal = { key: string; text: string; date: string };
export type LifeGuess = { kind: LifeEventKind; signals: LifeSignal[] };

const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

type Window = { from: string; asOf: string };
const inWindow = (t: { date: string }, w: Window) => t.date > w.from && t.date <= w.asOf;
const nameOf = (t: DetectionTransaction) => merchantOf(t)?.name ?? t.merchantName ?? t.description;
const keyOf = (t: DetectionTransaction) => merchantOf(t)?.key ?? t.description.toLowerCase();
const spending = (input: DetectionInput) =>
  input.transactions.filter((t) => t.amountCents > 0).sort(byDate);

// A payee paid for the first time inside the window, by people paid before it too.
function newPayees(
  input: DetectionInput,
  w: Window,
  matches: (t: DetectionTransaction) => boolean,
): DetectionTransaction[] {
  const all = spending(input).filter(matches);
  const firsts = new Map<string, DetectionTransaction>();
  for (const t of all) if (!firsts.has(keyOf(t))) firsts.set(keyOf(t), t);
  const before = all.some((t) => t.date <= w.from);
  return before ? [...firsts.values()].filter((t) => inWindow(t, w)) : [];
}

function movingSignals(input: DetectionInput, w: Window): LifeSignal[] {
  const out: LifeSignal[] = [];
  const recent = spending(input).filter((t) => inWindow(t, w));
  const mover = recent.find((t) => merchantMatches(keyOf(t), MOVING_MERCHANTS));
  if (mover) {
    out.push({
      key: "moving_company",
      text: `a ${nameOf(mover)} charge on ${shortDate(mover.date)}`,
      date: mover.date,
    });
  }
  const housing = newPayees(
    input,
    w,
    (t) =>
      t.pfcDetailed === "RENT_AND_UTILITIES_RENT" ||
      t.pfcDetailed === "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
  )[0];
  if (housing) {
    const what = housing.pfcDetailed === "RENT_AND_UTILITIES_RENT" ? "rent" : "mortgage";
    out.push({
      key: "new_housing",
      text: `a first ${what} payment to ${nameOf(housing)}`,
      date: housing.date,
    });
  }
  const utility = newPayees(
    input,
    w,
    (t) => t.pfcPrimary === "RENT_AND_UTILITIES" && t.pfcDetailed !== "RENT_AND_UTILITIES_RENT",
  )[0];
  if (utility) {
    out.push({
      key: "new_utility",
      text: `a new utility bill from ${nameOf(utility)}`,
      date: utility.date,
    });
  }
  const furniture = recent.filter((t) => t.pfcDetailed === "HOME_IMPROVEMENT_FURNITURE");
  const furnitureCents = furniture.reduce((sum, t) => sum + t.amountCents, 0);
  if (furnitureCents >= MOVING_FURNITURE_MIN_CENTS) {
    out.push({
      key: "furniture",
      text: `${formatCents(furnitureCents)} on furniture`,
      date: furniture.at(-1)!.date,
    });
  }
  return out;
}

function newJobSignals(input: DetectionInput, w: Window): LifeSignal[] {
  const out: LifeSignal[] = [];
  const all = employers(input);
  for (const employer of all) {
    const { deposits, name } = employer;
    const first = deposits[0];
    const last = deposits.at(-1)!;
    const othersBefore = all.some(
      (e) => e !== employer && e.deposits.some((d) => d.date < first.date),
    );
    if (inWindow(first, w) && othersBefore && !out.some((s) => s.key === "new_employer")) {
      out.push({
        key: "new_employer",
        text: `a first paycheck from ${name} on ${shortDate(first.date)}`,
        date: first.date,
      });
    }
    if (deposits.length < PAYCHECK_MIN_HISTORY) continue;
    const gaps = deposits.slice(1).map((d, i) => daysBetween(deposits[i].date, d.date));
    const due = addDays(last.date, Math.round(median(gaps)) + PAYCHECK_LATE_DAYS);
    if (due < w.asOf && due > w.from && !out.some((s) => s.key === "paychecks_stopped")) {
      out.push({
        key: "paychecks_stopped",
        text: `no paycheck from ${name} since ${shortDate(last.date)}`,
        date: due,
      });
    }
    const before = median(deposits.slice(0, -1).map((d) => -d.amountCents));
    const now = -last.amountCents;
    if (
      inWindow(last, w) &&
      Math.abs(now - before) >= before * NEW_JOB_PAY_CHANGE_SHARE &&
      !out.some((s) => s.key === "pay_changed")
    ) {
      out.push({
        key: "pay_changed",
        text: `a ${now > before ? "bigger" : "smaller"} paycheck from ${name}: ${formatCents(now)}, from ${formatCents(before)}`,
        date: last.date,
      });
    }
  }
  return out;
}

function babySignals(input: DetectionInput, w: Window): LifeSignal[] {
  const out: LifeSignal[] = [];
  const recent = spending(input).filter((t) => inWindow(t, w));
  const store = recent.find((t) => merchantMatches(keyOf(t), BABY_MERCHANTS));
  if (store) {
    out.push({ key: "baby_store", text: `a purchase at ${nameOf(store)}`, date: store.date });
  }
  const care = recent.find((t) => t.pfcDetailed === "GENERAL_SERVICES_CHILDCARE");
  if (care) out.push({ key: "childcare", text: `a childcare payment`, date: care.date });
  const hospital = recent.find(
    (t) =>
      t.pfcPrimary === "MEDICAL" &&
      t.amountCents >= BABY_HOSPITAL_MIN_CENTS &&
      BABY_HOSPITAL_WORDS.test(`${t.description} ${t.merchantName ?? ""}`),
  );
  if (hospital) {
    out.push({
      key: "hospital",
      text: `a ${formatCents(hospital.amountCents)} hospital bill`,
      date: hospital.date,
    });
  }
  return out;
}

const SIGNALS: Record<LifeEventKind, (input: DetectionInput, w: Window) => LifeSignal[]> = {
  moving: movingSignals,
  new_job: newJobSignals,
  new_baby: babySignals,
};

export function lifeEventGuesses(input: DetectionInput): LifeGuess[] {
  const w = { from: addDays(input.asOf, -LIFE_SIGNAL_DAYS), asOf: input.asOf };
  return LIFE_EVENT_KINDS.flatMap((kind): LifeGuess[] => {
    const signals = SIGNALS[kind](input, w).sort((a, b) => a.date.localeCompare(b.date));
    return new Set(signals.map((s) => s.key)).size >= LIFE_SIGNALS_NEEDED
      ? [{ kind, signals }]
      : [];
  });
}
