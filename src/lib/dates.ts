// Date helpers shared across the app. Days are UTC calendar days written "YYYY-MM-DD".

// One day in milliseconds.
export const DAY_MS = 86_400_000;

// The UTC calendar day of a moment, as "YYYY-MM-DD".
export const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

// The day `days` after a "YYYY-MM-DD" day (before it, when negative).
export const addDays = (day: string, days: number): string =>
  isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS));
