import {
  ACTIVE_WITHIN_INTERVALS,
  NEVER_PAYROLL_CATEGORIES,
  PAYCHECK_MIN_CENTS,
  PAYDAY_GAP_DAYS,
  PAYDAY_MAX_SHIFT_DAYS,
  PAYDAY_MIN_PAYCHECKS,
  PAYDAY_OFF_SCHEDULE_SHARE,
  PAYDAY_POSTING_DAYS,
  PAYROLL_CATEGORIES,
  PAYROLL_LEGACY_CATEGORIES,
  PAYROLL_WORDS,
  SEMI_MONTHLY_MIN_GAP_DAYS,
} from "@/config/detection";
import { normalizeMerchant } from "@/data-sources/merchant";
import { isBankingDay } from "./business-days";
import { byDate, inLookback } from "./helpers";
import type { DetectionInput, DetectionTransaction } from "./types";
import {
  addDays,
  dayNumber,
  dayOfMonth,
  daysBetween,
  daysInMonth,
  DAYS_PER_WEEK,
  firstOfMonth,
  fromDayNumber,
  LAST_DAY_OF_MONTH,
} from "./units";

// Paydays (spec step 182): when each employer pays, from payroll-like deposits only, so
// $1.02 of interest or a refund is never a payday. Weekly, every two weeks, twice a month
// on fixed days (the 1st and 15th, the 15th and the last day) and monthly, each with the
// shift the employer uses when payday is a weekend or bank holiday: the banking day
// before, the one after, or none (some banks post on weekends). Safe to spend, the
// forecast, the calendar and the chat all plan around these. Pure.

export type PayFrequency = "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY";
export type PayShift = "before" | "after" | "none";

export type PaySchedule = {
  // Stable per employer, e.g. "employer:acme corp".
  key: string;
  employer: string;
  accountId: string;
  frequency: PayFrequency;
  // Twice a month and monthly: the days of the month (31 is the month's last day).
  days: number[];
  // Weekly and every two weeks: one payday before any shift; the rest step from it.
  anchor: string | null;
  shift: PayShift;
  // The latest paycheck, as a positive amount, and its date.
  amountCents: number;
  lastDate: string;
  paychecks: number;
  active: boolean;
};

export type Payday = {
  date: string;
  key: string;
  employer: string;
  amountCents: number;
  accountId: string;
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PAYROLL_PATTERN = new RegExp(
  `\\b(?:${PAYROLL_WORDS.map((w) => escape(w).replace(/ /g, "\\s*")).join("|")})\\b`,
  "i",
);
// The words banks add to a paycheck aren't the employer: "ACME CORP PAYROLL" is Acme Corp.
const PAY_NOISE = new RegExp(
  `\\b(?:${[...PAYROLL_WORDS, "ppd", "ach", "pay", "dep", "deposit"]
    .map((w) => escape(w).replace(/ /g, "\\s*"))
    .join("|")})\\b`,
  "gi",
);

// A deposit that's a paycheck: big enough, payroll by category or by name, never interest,
// dividends, a refund or a transfer.
export function isPaycheck(t: DetectionTransaction): boolean {
  if (t.amountCents > -PAYCHECK_MIN_CENTS) return false;
  const category = t.pfcDetailed ?? "";
  if ((NEVER_PAYROLL_CATEGORIES as readonly string[]).includes(category)) return false;
  if ((PAYROLL_CATEGORIES as readonly string[]).includes(category)) return true;
  if (PAYROLL_LEGACY_CATEGORIES.includes(category)) return true;
  return PAYROLL_PATTERN.test(`${t.description} ${t.merchantName ?? ""}`);
}

function employerOf(t: DetectionTransaction): { key: string; name: string } {
  const raw = t.merchantName ?? t.description;
  const cleaned = raw.replace(PAY_NOISE, " ").replace(/\s+/g, " ").trim() || raw;
  const merchant = normalizeMerchant(cleaned);
  return {
    key: merchant?.key ?? cleaned.toLowerCase(),
    name: merchant?.name ?? cleaned,
  };
}

type Deposit = { date: string; amountCents: number; accountId: string };

// Each employer's paychecks, oldest first; two deposits on one day (pay split between
// accounts) are one paycheck.
function byEmployer(input: DetectionInput) {
  const groups = new Map<string, { name: string; deposits: Deposit[] }>();
  for (const t of inLookback(input).filter(isPaycheck).sort(byDate)) {
    const { key, name } = employerOf(t);
    const group = groups.get(key) ?? { name, deposits: [] };
    const last = group.deposits.at(-1);
    if (last && last.date === t.date) last.amountCents += -t.amountCents;
    else group.deposits.push({ date: t.date, amountCents: -t.amountCents, accountId: t.accountId });
    groups.set(key, group);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}

type Rule = { frequency: PayFrequency; days: number[]; anchor: string | null; shift: PayShift };

const STEPPED: readonly PayFrequency[] = ["WEEKLY", "BIWEEKLY"];
const stepOf = (frequency: PayFrequency) =>
  STEPPED.includes(frequency) ? PAYDAY_GAP_DAYS[frequency] : null;

// Day numbers (src/detection/units.ts) keep the search over every possible schedule fast
// enough to run on each page load.
const toDay = dayNumber;
const fromDay = fromDayNumber;

const banking = new Map<number, boolean>();
function isBanking(day: number): boolean {
  let known = banking.get(day);
  if (known === undefined) {
    known = isBankingDay(fromDay(day));
    banking.set(day, known);
  }
  return known;
}

function shifted(day: number, shift: PayShift): number {
  if (shift === "none") return day;
  const step = shift === "before" ? -1 : 1;
  let d = day;
  while (!isBanking(d)) d += step;
  return d;
}

// The paydays before any shift, from `from` through `until` (day numbers).
function scheduled(rule: Rule, from: number, until: number): number[] {
  const out: number[] = [];
  const step = stepOf(rule.frequency);
  if (step && rule.anchor) {
    const anchor = toDay(rule.anchor);
    for (let d = anchor + Math.ceil((from - anchor) / step) * step; d <= until; d += step)
      out.push(d);
    return out;
  }
  // The first of each month from `from`'s month on.
  for (let first = toDay(firstOfMonth(fromDay(from))); first <= until;) {
    const length = daysInMonth(fromDay(first));
    for (const day of rule.days) {
      const d = first + Math.min(day, length) - 1;
      if (d >= from && d <= until) out.push(d);
    }
    first += length;
  }
  return out;
}

// The days money arrives on a rule, from `from` through `until`, oldest first.
function paydayDays(rule: Rule, from: number, until: number): number[] {
  // A payday a few days outside the range can shift into it.
  const days = scheduled(rule, from - DAYS_PER_WEEK, until + DAYS_PER_WEEK)
    .map((d) => shifted(d, rule.shift))
    .filter((d) => d >= from && d <= until);
  return [...new Set(days)].sort((a, b) => a - b);
}

function paydayDates(rule: Rule, from: string, until: string): string[] {
  return paydayDays(rule, toDay(from), toDay(until)).map(fromDay);
}

// How well a rule explains the paychecks: those on the day, those a day or so off, those
// it doesn't explain, and its paydays that had no paycheck. Stops early (null) once more
// than `allowed` paychecks are off the schedule.
function score(rule: Rule, deposits: number[], allowed: number) {
  const expected = paydayDays(
    rule,
    deposits[0] - PAYDAY_POSTING_DAYS,
    deposits.at(-1)! + PAYDAY_POSTING_DAYS,
  );
  const open = new Set(expected);
  let exact = 0;
  let unmatched = 0;
  for (const day of deposits) {
    if (open.delete(day)) {
      exact += 1;
      continue;
    }
    let close = false;
    for (let off = 1; off <= PAYDAY_POSTING_DAYS && !close; off += 1)
      close = open.delete(day - off) || open.delete(day + off);
    if (!close && ++unmatched > allowed) return null;
  }
  return { exact, unmatched, missing: open.size };
}

const SHIFTS: readonly PayShift[] = ["before", "none", "after"];

function candidates(deposits: number[]): Rule[] {
  const rules: Rule[] = [];
  // Weekly and every two weeks: one anchor per position in the cycle near a paycheck.
  for (const frequency of STEPPED) {
    const step = PAYDAY_GAP_DAYS[frequency];
    const anchors = new Map<number, number>();
    for (const day of deposits)
      for (let off = -PAYDAY_MAX_SHIFT_DAYS; off <= PAYDAY_MAX_SHIFT_DAYS; off += 1) {
        const phase = (((day + off) % step) + step) % step;
        if (!anchors.has(phase)) anchors.set(phase, day + off);
      }
    for (const anchor of anchors.values())
      for (const shift of SHIFTS)
        rules.push({ frequency, days: [], anchor: fromDay(anchor), shift });
  }
  // Twice a month and monthly: days of the month near the paychecks (31: the last day).
  const days = new Set<number>();
  for (const day of deposits) {
    const date = fromDay(day);
    const dom = dayOfMonth(date);
    const length = daysInMonth(date);
    for (let off = -PAYDAY_MAX_SHIFT_DAYS; off <= PAYDAY_MAX_SHIFT_DAYS; off += 1)
      if (dom + off >= 1 && dom + off <= LAST_DAY_OF_MONTH) days.add(dom + off);
    if (length - dom <= PAYDAY_MAX_SHIFT_DAYS) days.add(LAST_DAY_OF_MONTH);
  }
  const sorted = [...days].sort((a, b) => a - b);
  for (const shift of SHIFTS) {
    for (const day of sorted)
      rules.push({ frequency: "MONTHLY", days: [day], anchor: null, shift });
    for (const a of sorted)
      for (const b of sorted)
        if (
          b - a >= SEMI_MONTHLY_MIN_GAP_DAYS &&
          a + LAST_DAY_OF_MONTH - b >= SEMI_MONTHLY_MIN_GAP_DAYS
        )
          rules.push({ frequency: "SEMI_MONTHLY", days: [a, b], anchor: null, shift });
  }
  return rules;
}

// The rule that explains an employer's paychecks best, or null when none does.
export function payRule(deposits: Deposit[]): Rule | null {
  if (deposits.length < PAYDAY_MIN_PAYCHECKS) return null;
  const allowed = Math.floor(deposits.length * PAYDAY_OFF_SCHEDULE_SHARE);
  const days = deposits.map((d) => toDay(d.date));
  let best: { rule: Rule; off: number; exact: number } | null = null;
  for (const rule of candidates(days)) {
    const scored = score(rule, days, allowed);
    if (!scored || scored.missing > allowed) continue;
    const { exact, unmatched, missing } = scored;
    const off = unmatched + missing;
    // Fewest paychecks off the schedule, then most on the day; the first such rule wins
    // (shift "before" first: what most payroll does).
    if (!best || off < best.off || (off === best.off && exact > best.exact))
      best = { rule, off, exact };
  }
  return best?.rule ?? null;
}

// Every employer that pays on a schedule.
export function paySchedules(input: DetectionInput): PaySchedule[] {
  return byEmployer(input).flatMap(([key, { name, deposits }]): PaySchedule[] => {
    const rule = payRule(deposits);
    if (!rule) return [];
    const last = deposits.at(-1)!;
    return [
      {
        key: `employer:${key}`,
        employer: name,
        accountId: last.accountId,
        ...rule,
        amountCents: last.amountCents,
        lastDate: last.date,
        paychecks: deposits.length,
        active:
          daysBetween(last.date, input.asOf) <=
          PAYDAY_GAP_DAYS[rule.frequency] * ACTIVE_WITHIN_INTERVALS,
      },
    ];
  });
}

// Every paycheck expected after today through `until`, soonest first.
export function expectedPaydays(input: DetectionInput, until: string): Payday[] {
  return paySchedules(input)
    .filter((s) => s.active)
    .flatMap((s) =>
      paydayDates(s, addDays(input.asOf, 1), until)
        .filter((date) => date > s.lastDate)
        .map((date) => ({
          date,
          key: s.key,
          employer: s.employer,
          amountCents: s.amountCents,
          accountId: s.accountId,
        })),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

// The next paycheck within `days`, or null without a pay schedule.
export function nextPayday(input: DetectionInput, days: number): Payday | null {
  return expectedPaydays(input, addDays(input.asOf, days))[0] ?? null;
}
