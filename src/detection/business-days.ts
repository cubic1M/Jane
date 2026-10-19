import { addDays } from "./units";

// Banking days (spec step 182): weekdays that aren't a Federal Reserve holiday. Payroll
// that falls on a weekend or a holiday is paid the banking day before (or after). These are
// calendar facts, not tunable thresholds, so they live here rather than in
// src/config/detection.ts.

const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const iso = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);

// The nth (1-based) weekday of a month; n = -1 is the last one. Weekday 0 is Sunday.
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return iso(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(year, month, 0));
  const back = (lastDay.getUTCDay() - weekday + 7) % 7;
  return iso(year, month, lastDay.getUTCDate() - back);
}

// A fixed-date holiday on a Sunday is observed on the Monday. On a Saturday the Fed stays
// open the Friday before, so nothing moves.
const observed = (date: string) => (utc(date).getUTCDay() === 0 ? addDays(date, 1) : date);

const cache = new Map<number, Set<string>>();

// The Federal Reserve's bank holidays in a year, as observed.
export function bankHolidays(year: number): Set<string> {
  const known = cache.get(year);
  if (known) return known;
  const days = new Set([
    observed(iso(year, 1, 1)), // New Year's Day
    nthWeekday(year, 1, 1, 3), // Martin Luther King Jr. Day
    nthWeekday(year, 2, 1, 3), // Washington's Birthday
    nthWeekday(year, 5, 1, -1), // Memorial Day
    observed(iso(year, 6, 19)), // Juneteenth
    observed(iso(year, 7, 4)), // Independence Day
    nthWeekday(year, 9, 1, 1), // Labor Day
    nthWeekday(year, 10, 1, 2), // Columbus Day
    observed(iso(year, 11, 11)), // Veterans Day
    nthWeekday(year, 11, 4, 4), // Thanksgiving
    observed(iso(year, 12, 25)), // Christmas
  ]);
  cache.set(year, days);
  return days;
}

export function isBankingDay(date: string): boolean {
  const weekday = utc(date).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !bankHolidays(Number(date.slice(0, 4))).has(date);
}

// The date itself when it's a banking day, else the banking day before (or after).
export function bankingDayOnOrBefore(date: string): string {
  let day = date;
  while (!isBankingDay(day)) day = addDays(day, -1);
  return day;
}

export function bankingDayOnOrAfter(date: string): string {
  let day = date;
  while (!isBankingDay(day)) day = addDays(day, 1);
  return day;
}
