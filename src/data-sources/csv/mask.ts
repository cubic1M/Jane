import { looksLikeOfx } from "@/data-sources/ofx/parse-ofx";
import { normalizeHeader } from "./formats";
import { parseCsv } from "./parse-csv";

// The last four of the account a statement is from, when it says: an OFX/QFX file's account
// number, a "Card No." or "Account #" column (Capital One, Amex), or the file's name ("Chase4321_
// Activity_20261027.CSV", "September2026_1234.csv"). Null when nothing says. Matched against a
// linked account's mask (Plaid: "the last 2-4 alphanumeric characters" of its number), so the same
// account isn't counted twice (src/lib/import/wrong-account.ts, linkedAccountNote).
export function statementMask(name: string, text: string): string | null {
  const last4 = (digits: string) => (digits.length >= 2 ? digits.slice(-4) : null);
  if (looksLikeOfx(name, text)) {
    return last4(/<ACCTID>\s*([^<\s]+)/i.exec(text)?.[1]?.replace(/\D/g, "") ?? "");
  }
  const [header, first] = parseCsv(text.slice(0, 4000)).map((r) => r.fields);
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
