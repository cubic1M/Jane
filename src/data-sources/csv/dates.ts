// Dates in a CSV whose columns the person picked (column-mapping.ts). Bank layouts in
// formats.ts each know their own date format; a file from anywhere else may write 05/09/2026
// for May 9 or for 5 September, so the order is decided from the whole column, and when the
// dates can't settle it the person is asked. Never guessed silently.

// Month first (US) or day first.
export type DateOrder = "mdy" | "dmy";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function isoOf(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null;
  if (date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

const fullYear = (year: string) => (year.length === 2 ? 2000 + Number(year) : Number(year));

// 05/09/2026, 5-9-26, 05.09.2026: the two numbers before the year, in the order written.
export function numericParts(value: string): [number, number, number] | null {
  const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), fullYear(match[3])] : null;
}

// YYYY-MM-DD, also with slashes or dots, with an optional time after it.
function parseIso(value: string): string | null {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ][\d:.]+Z?)?$/.exec(value.trim());
  return match ? isoOf(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

// "Sep 5, 2026", "September 5 2026", "5 Sep 2026", "05-Sep-2026", "5-Sep-26".
export function parseTextDate(value: string): string | null {
  const text = value.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  // "sep", "sept" or "september": the first three letters or more of a month's name.
  const monthOf = (name: string) => {
    const i = name.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(name)) : -1;
    return i === -1 ? null : i + 1;
  };
  let match = /^([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)? (\d{4})$/.exec(text);
  if (match) {
    const month = monthOf(match[1]);
    return month ? isoOf(Number(match[3]), month, Number(match[2])) : null;
  }
  match = /^(\d{1,2})[ -]([a-z]{3,9})\.?[ -](\d{2}|\d{4})$/.exec(text);
  if (match) {
    const month = monthOf(match[2]);
    return month ? isoOf(fullYear(match[3]), month, Number(match[1])) : null;
  }
  return null;
}

// One date, read with the column's order (needed only for numeric dates).
export function parseDate(value: string, order: DateOrder | null): string | null {
  const iso = parseIso(value) ?? parseTextDate(value);
  if (iso) return iso;
  const parts = numericParts(value);
  if (!parts) return null;
  const [first, second, year] = parts;
  // Both orders read the same when the two numbers match (03/03/2026).
  if (first === second) return isoOf(year, first, first);
  if (!order) return null;
  return order === "mdy" ? isoOf(year, first, second) : isoOf(year, second, first);
}

// Whether it reads as a date in some order: for telling a header row from a transaction.
export const looksLikeDate = (value: string) =>
  parseDate(value, "mdy") !== null || parseDate(value, "dmy") !== null;

// Dates in a statement come in order, newest or oldest first.
function inOrder(dates: (string | null)[]): boolean {
  if (dates.some((d) => d === null)) return false;
  const list = dates as string[];
  const up = list.every((d, i) => i === 0 || d >= list[i - 1]);
  const down = list.every((d, i) => i === 0 || d <= list[i - 1]);
  return up || down;
}

// How a column writes its numeric dates. Null: none are numeric (ISO or text dates, or not
// dates at all), so there is nothing to ask. "unknown": the dates can't tell, ask the person.
export function detectDateOrder(values: string[]): DateOrder | "unknown" | null {
  const numeric = values.map(numericParts).filter((p) => p !== null);
  if (numeric.length === 0) return null;
  if (numeric.every(([a, b]) => a === b)) return "mdy";
  const dayFirst = numeric.some(([a]) => a > 12);
  const monthFirst = numeric.some(([, b]) => b > 12);
  if (dayFirst !== monthFirst) return dayFirst ? "dmy" : "mdy";
  // Neither (or both, a mixed column): settled only when one order keeps the rows in date
  // order and the other doesn't.
  if (dayFirst && monthFirst) return "unknown";
  const asMdy = inOrder(values.filter((v) => numericParts(v)).map((v) => parseDate(v, "mdy")));
  const asDmy = inOrder(values.filter((v) => numericParts(v)).map((v) => parseDate(v, "dmy")));
  if (asMdy !== asDmy) return asMdy ? "mdy" : "dmy";
  return "unknown";
}
