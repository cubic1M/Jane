import { readFileSync } from "node:fs";
import { basename } from "node:path";

// Statement fixtures with fixed dates age with the calendar: e2e/fixtures/messy ends in October
// 2026, and a month or two on, what Jane finds in it changes (a subscription last charged long ago
// stops being one to review). These are the same files with every MM/DD/YYYY date moved by one
// number of days, so the latest falls DAYS_BEFORE_TODAY days ago. The gaps between charges, and
// between the files, stay as they were. Given to setInputFiles in place of the paths.

const DAYS_BEFORE_TODAY = 3;
const DAY_MS = 86_400_000;
const US_DATE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;

const parse = (m: string, d: string, y: string) => Date.UTC(Number(y), Number(m) - 1, Number(d));
const format = (ms: number) => {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getUTCMonth() + 1)}/${two(d.getUTCDate())}/${d.getUTCFullYear()}`;
};

export function datedToToday(paths: string[], now = new Date()) {
  const texts = paths.map((p) => readFileSync(p, "utf8"));
  const latest = Math.max(
    ...texts.flatMap((t) => [...t.matchAll(US_DATE)].map(([, m, d, y]) => parse(m, d, y))),
  );
  const target =
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
    DAYS_BEFORE_TODAY * DAY_MS;
  const shift = Math.round((target - latest) / DAY_MS) * DAY_MS;
  return texts.map((text, i) => ({
    name: basename(paths[i]),
    mimeType: "text/csv",
    buffer: Buffer.from(text.replace(US_DATE, (_, m, d, y) => format(parse(m, d, y) + shift))),
  }));
}
