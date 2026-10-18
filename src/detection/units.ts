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
