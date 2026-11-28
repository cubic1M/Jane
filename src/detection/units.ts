import { addDays, daysBetween, isoDay as isoDate } from "@/lib/dates";

// Unit conversions and date math. These are facts about calendars, not tunable
// thresholds, so they live here rather than in src/config/detection.ts.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const DAYS_PER_MONTH = 365.25 / 12;
export const MONTHS_PER_YEAR = 12;
export const BASIS_POINTS = 10_000;

// Dates are YYYY-MM-DD strings, read as UTC, so time zones never shift a day.
function toUtc(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

// The same day math as src/lib/dates.ts, under the names the detectors use.
export { addDays, daysBetween, isoDay as isoDate } from "@/lib/dates";

// The months a history spans for pay too sparse for a schedule, from its first line to its newest:
// at least one. Counted between lines, never to today, so with no new data it holds still: two
// paychecks every two weeks read $1,376.80 a month on Nov 20 and $1,351.82 on Nov 21 on the profile
// while Home's line read $1,377 (debug 2, sweep 13). Home, the profile, the tax cards and the federal
// estimate all spread such pay over this.
export function monthsBetweenLines(first: string, newest: string): number {
  return Math.max(1, (daysBetween(first, newest) + 1) / DAYS_PER_MONTH);
}

export function monthsBefore(date: string, months: number): string {
  const d = new Date(toUtc(date));
  d.setUTCMonth(d.getUTCMonth() - months);
  return isoDate(d);
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// The next date of a recurring charge. Monthly, quarterly and yearly charges keep their
// day of the month (clamped to the month's last day); the rest step by days.
const STEP: Record<string, { months: number } | { days: number }> = {
  WEEKLY: { days: 7 },
  BIWEEKLY: { days: 14 },
  SEMI_MONTHLY: { days: 15 },
  MONTHLY: { months: 1 },
  QUARTERLY: { months: 3 },
  SEMIANNUALLY: { months: 6 },
  ANNUALLY: { months: 12 },
};

export function nextOccurrence(date: string, frequency: string, anchorDay?: number): string {
  const step = STEP[frequency];
  if (!step) throw new Error(`Unknown frequency ${frequency}`);
  if ("days" in step) return addDays(date, step.days);
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + step.months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(anchorDay ?? day, lastDay));
  return isoDate(target);
}

// Day numbers (days since 1970-01-01, UTC), for date math in tight loops.
// The two conversions are pure and asked for the same few hundred days thousands of times (the
// pay schedules score every candidate rule over the year): each answer is kept, up to a few days'
// worth, so a page's detection does not spend a tenth of its time making date strings.
const KEPT_DAYS = 20_000;
const days = new Map<string, number>();
const dates = new Map<number, string>();
export const dayNumber = (date: string) => {
  let n = days.get(date);
  if (n === undefined) {
    n = toUtc(date) / MS_PER_DAY;
    if (days.size < KEPT_DAYS) days.set(date, n);
  }
  return n;
};
export const fromDayNumber = (day: number) => {
  let d = dates.get(day);
  if (d === undefined) {
    d = isoDate(new Date(day * MS_PER_DAY));
    if (dates.size < KEPT_DAYS) dates.set(day, d);
  }
  return d;
};

// Days in a month (1-12), and the most a month has: "the 31st" is a month's last day.
export const LAST_DAY_OF_MONTH = 31;
export const DAYS_PER_WEEK = 7;
export function daysInMonth(date: string): number {
  const d = new Date(toUtc(date));
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

export function firstOfMonth(date: string): string {
  const d = new Date(toUtc(date));
  return isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

export function dayOfMonth(date: string): number {
  return new Date(toUtc(date)).getUTCDate();
}
