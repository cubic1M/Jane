import { parseMoneyToCents } from "@/lib/money";

// One entry per bank export layout. A file's header row picks its format; add a new
// bank by adding an entry here plus a fixture and tests.

export type ParsedRow = {
  date: string;
  // Positive is money out (Plaid's convention), whatever sign the bank uses.
  amountCents: number;
  description: string;
  hints: { bankCategory?: string; bankType?: string };
};

export type RowResult = { ok: true; row: ParsedRow } | { ok: false; reason: string };

export type CsvFormat = {
  id: string;
  label: string;
  // Lower-cased header names that must all be present for the format to match.
  requiredHeaders: readonly string[];
  parseRow(get: (header: string) => string): RowResult;
};

// MM/DD/YYYY, as US banks export it, to YYYY-MM-DD.
export function parseUsDate(value: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, month, day, year] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function parseCommon(dateText: string, amountText: string, description: string) {
  const date = parseUsDate(dateText);
  if (!date) return { ok: false as const, reason: `Unreadable date "${dateText}"` };
  const cents = parseMoneyToCents(amountText);
  if (cents === null) return { ok: false as const, reason: `Unreadable amount "${amountText}"` };
  if (!description.trim()) return { ok: false as const, reason: "Missing description" };
  return { ok: true as const, date, cents, description: description.trim() };
}

function optional(value: string): string | undefined {
  return value.trim() || undefined;
}

// Chase checking and savings: "Details,Posting Date,Description,Amount,Type,Balance,
// Check or Slip #". Amounts are negative for money leaving the account.
export const chaseChecking: CsvFormat = {
  id: "chase_checking",
  label: "Chase checking or savings",
  requiredHeaders: ["details", "posting date", "description", "amount", "type", "balance"],
  parseRow(get) {
    const common = parseCommon(get("posting date"), get("amount"), get("description"));
    if (!common.ok) return common;
    return {
      ok: true,
      row: {
        date: common.date,
        amountCents: -common.cents,
        description: common.description,
        hints: { bankType: optional(get("type")) },
      },
    };
  },
};

// Chase credit cards: "Transaction Date,Post Date,Description,Category,Type,Amount,Memo".
// Purchases are negative and payments or refunds positive.
export const chaseCreditCard: CsvFormat = {
  id: "chase_credit_card",
  label: "Chase credit card",
  requiredHeaders: ["transaction date", "post date", "description", "category", "type", "amount"],
  parseRow(get) {
    const common = parseCommon(get("post date"), get("amount"), get("description"));
    if (!common.ok) return common;
    return {
      ok: true,
      row: {
        date: common.date,
        amountCents: -common.cents,
        description: common.description,
        hints: { bankCategory: optional(get("category")), bankType: optional(get("type")) },
      },
    };
  },
};

export const CSV_FORMATS: readonly CsvFormat[] = [chaseChecking, chaseCreditCard];

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

export function detectFormat(headers: string[]): CsvFormat | null {
  const present = new Set(headers.map(normalizeHeader));
  return CSV_FORMATS.find((format) => format.requiredHeaders.every((h) => present.has(h))) ?? null;
}
