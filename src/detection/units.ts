// Unit conversions and date math. These are facts about calendars, not tunable
// thresholds, so they live here rather than in src/config/detection.ts.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const DAYS_PER_MONTH = 365.25 / 12;
export const BASIS_POINTS = 10_000;

// Dates are YYYY-MM-DD strings, read as UTC, so time zones never shift a day.
function toUtc(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / MS_PER_DAY);
}

export function monthsBefore(date: string, months: number): string {
  const d = new Date(toUtc(date));
  d.setUTCMonth(d.getUTCMonth() - months);
  return isoDate(d);
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function addDays(date: string, days: number): string {
  return isoDate(new Date(toUtc(date) + days * MS_PER_DAY));
}

// The next date of a recurring charge. Monthly, quarterly and yearly charges keep their
// day of the month (clamped to the month's last day); the rest step by days.
const STEP: Record<string, { months: number } | { days: number }> = {
  WEEKLY: { days: 7 },
  BIWEEKLY: { days: 14 },
  SEMI_MONTHLY: { days: 15 },
  MONTHLY: { months: 1 },
  QUARTERLY: { months: 3 },
  ANNUALLY: { months: 12 },
};

export function nextOccurrence(date: string, frequency: string, anchorDay?: number): string {
  const step = STEP[frequency];
  if (!step) throw new Error(`Unknown frequency ${frequency}`);
  if ("days" in step) return addDays(date, step.days);
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + step.months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(anchorDay ?? day, lastDay));
  return isoDate(target);
}

// Day numbers (days since 1970-01-01, UTC), for date math in tight loops.
export const dayNumber = (date: string) => toUtc(date) / MS_PER_DAY;
export const fromDayNumber = (day: number) => isoDate(new Date(day * MS_PER_DAY));

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
