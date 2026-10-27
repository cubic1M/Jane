import { looksLikeOfx } from "@/data-sources/ofx/parse-ofx";
import { normalizeHeader } from "./formats";
import { parseCsv, type CsvRecord } from "./parse-csv";

// How much of a file's start is read for its header and first row.
const HEAD_CHARS = 4000;

// The last four of the account a statement is from, when it says: an OFX/QFX file's account
// number, a "Card No." or "Account #" column (Capital One, Amex), or the file's name ("Chase4321_
// Activity_20261027.CSV", "September2026_1234.csv"). Null when nothing says. Matched against a
// linked account's mask (Plaid: "the last 2-4 alphanumeric characters" of its number), so the same
// account isn't counted twice (src/lib/import/wrong-account.ts, linkedAccountNote).
// The header and first row, read from the file's start. A cut there can fall inside a quoted
// field (Wells Fargo quotes every field; Amex has a two-line address), which won't parse on its
// own: then the whole file, and nothing at all rather than a failed upload (QA round 14: Preview
// threw for every Wells Fargo and Amex file longer than the cut).
function firstRecords(text: string): CsvRecord[] {
  for (const part of [text.slice(0, HEAD_CHARS), text]) {
    try {
      return parseCsv(part);
    } catch {
      // Try the next, longer read.
    }
  }
  return [];
}

export function statementMask(name: string, text: string): string | null {
  const last4 = (digits: string) => (digits.length >= 2 ? digits.slice(-4) : null);
  if (looksLikeOfx(name, text)) {
    return last4(/<ACCTID>\s*([^<\s]+)/i.exec(text)?.[1]?.replace(/\D/g, "") ?? "");
  }
  const [header, first] = firstRecords(text).map((r) => r.fields);
  const column = (header ?? [])
    .map(normalizeHeader)
    .findIndex((h) => /^(card no\.?|account #)$/.test(h));
  if (column !== -1 && first) {
    const digits = (first[column] ?? "").replace(/\D/g, "");
    if (digits) return last4(digits);
  }
  // Four digits in the name that aren't a year or a date: 1234 in "Chase1234_Activity_20261027".
  const groups = name.replace(/\.[a-z0-9]+$/i, "").match(/(?<!\d)\d{4}(?!\d)/g) ?? [];
  const mask = groups.find((g) => !/^(19|20)\d\d$/.test(g));
  return mask ?? null;
}
