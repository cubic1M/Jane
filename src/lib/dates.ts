// Date helpers shared across the app. Days are UTC calendar days written "YYYY-MM-DD".

// One day in milliseconds.
export const DAY_MS = 86_400_000;

// The UTC calendar day of a moment, as "YYYY-MM-DD".
export const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

// The day `days` after a "YYYY-MM-DD" day (before it, when negative).
export const addDays = (day: string, days: number): string =>
  isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS));

// The same day `months` later (earlier when negative), held to the last day of a shorter month:
// Jan 31 + 1 month is Feb 28.
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(d, last));
  return isoDay(date);
}

// A "YYYY-MM" month `by` months later (earlier when negative).
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

// Whole days from one "YYYY-MM-DD" day to another: negative when `to` comes first.
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
