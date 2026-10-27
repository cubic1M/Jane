import type { AccountKind } from "@/data-sources/types";
import { parseMoneyToCents } from "@/lib/money";
import type { CsvRecord } from "./parse-csv";

// One entry per bank export layout. A file's header row picks its format; add a new
// bank by adding an entry here plus a fixture and tests. A file that matches none gets a
// column picker on /import (column-mapping.ts).

export type ParsedRow = {
  date: string;
  // Positive is money out (Plaid's convention), whatever sign the bank uses.
  amountCents: number;
  description: string;
  hints: { bankCategory?: string; bankType?: string };
};

// `silent`: not a transaction at all (Bank of America's "Beginning balance" line), so it's left
// out without a "skipped" message.
export type RowResult =
  { ok: true; row: ParsedRow } | { ok: false; reason: string; silent?: boolean };

export type CsvFormat = {
  id: string;
  label: string;
  // Lower-cased header names that must all be present for the format to match.
  requiredHeaders: readonly string[];
  // The account a first upload in this format makes (on /import), before the person edits it.
  account: { name: string; kind: AccountKind };
  parseRow(get: (header: string) => string): RowResult;
};

// An export with no header row (Wells Fargo): names for its columns in order, and a test the
// first row must pass.
export type HeaderlessFormat = Omit<CsvFormat, "requiredHeaders"> & {
  columns: readonly string[];
  matches(fields: string[]): boolean;
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

// MM/DD/YY (Capital One 360) to YYYY-MM-DD, taking the year as 20YY.
export function parseShortUsDate(value: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(value.trim());
  return match ? parseUsDate(`${match[1]}/${match[2]}/20${match[3]}`) : null;
}

// YYYY-MM-DD (Capital One cards) as it is, if it's a real day.
export function parseIsoDate(value: string): string | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  return match ? parseUsDate(`${match[2]}/${match[3]}/${match[1]}`) : null;
}

function parseCommon(
  dateText: string,
  amountText: string,
  description: string,
  readDate: (value: string) => string | null = parseUsDate,
) {
  const date = readDate(dateText);
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
  account: { name: "Chase checking", kind: "checking" },
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
  account: { name: "Chase card", kind: "credit_card" },
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

// Two columns, one filled per row: money out and money in. Some banks sign the second
// (Citi writes a payment as -41.00 under Credit), so both are read without their sign.
export function debitCreditCents(
  debitText: string,
  creditText: string,
  parse: (text: string) => number | null = parseMoneyToCents,
): number | string {
  if (!debitText.trim() && !creditText.trim()) return "Missing amount";
  const debit = debitText.trim() ? parse(debitText) : 0;
  if (debit === null) return `Unreadable amount "${debitText}"`;
  const credit = creditText.trim() ? parse(creditText) : 0;
  if (credit === null) return `Unreadable amount "${creditText}"`;
  return Math.abs(debit) - Math.abs(credit) || 0;
}

function debitCreditRow(
  dateText: string,
  description: string,
  debitText: string,
  creditText: string,
  readDate: (value: string) => string | null,
  hints: ParsedRow["hints"],
): RowResult {
  const date = readDate(dateText);
  if (!date) return { ok: false, reason: `Unreadable date "${dateText}"` };
  if (!description.trim()) return { ok: false, reason: "Missing description" };
  const cents = debitCreditCents(debitText, creditText);
  if (typeof cents === "string") return { ok: false, reason: cents };
  return { ok: true, row: { date, amountCents: cents, description: description.trim(), hints } };
}

// Bank of America checking and savings: a few summary lines ("Description,,Summary Amt.",
// "Beginning balance as of …") above "Date,Description,Amount,Running Bal.". The first row
// under it is the beginning balance with no amount. Money out is negative.
export const bankOfAmericaChecking: CsvFormat = {
  id: "bofa_checking",
  label: "Bank of America checking or savings",
  account: { name: "Bank of America checking", kind: "checking" },
  requiredHeaders: ["date", "description", "amount", "running bal."],
  parseRow(get) {
    if (!get("amount").trim() && /^beginning balance/i.test(get("description").trim())) {
      return { ok: false, reason: "Beginning balance", silent: true };
    }
    const common = parseCommon(get("date"), get("amount"), get("description"));
    if (!common.ok) return common;
    return {
      ok: true,
      row: {
        date: common.date,
        amountCents: -common.cents,
        description: common.description,
        hints: {},
      },
    };
  },
};

// Bank of America credit cards: "Posted Date,Reference Number,Payee,Address,Amount".
// Purchases are negative and payments positive.
export const bankOfAmericaCreditCard: CsvFormat = {
  id: "bofa_credit_card",
  label: "Bank of America credit card",
  account: { name: "Bank of America card", kind: "credit_card" },
  requiredHeaders: ["posted date", "reference number", "payee", "address", "amount"],
  parseRow(get) {
    const common = parseCommon(get("posted date"), get("amount"), get("payee"));
    if (!common.ok) return common;
    return {
      ok: true,
      row: {
        date: common.date,
        amountCents: -common.cents,
        description: common.description,
        hints: {},
      },
    };
  },
};

// Wells Fargo: no header row, five quoted columns: date, amount, "*", a check number (often
// empty) and the description. Money out is negative.
export const wellsFargo: HeaderlessFormat = {
  id: "wells_fargo",
  label: "Wells Fargo",
  account: { name: "Wells Fargo checking", kind: "checking" },
  columns: ["date", "amount", "posted", "check number", "description"],
  matches: (fields) =>
    fields.length === 5 &&
    parseUsDate(fields[0]) !== null &&
    parseMoneyToCents(fields[1]) !== null &&
    fields[2].trim() === "*",
  parseRow(get) {
    const common = parseCommon(get("date"), get("amount"), get("description"));
    if (!common.ok) return common;
    return {
      ok: true,
      row: {
        date: common.date,
        amountCents: -common.cents,
        description: common.description,
        hints: {},
      },
    };
  },
};

// Capital One credit cards: "Transaction Date,Posted Date,Card No.,Description,Category,
// Debit,Credit", dates as YYYY-MM-DD. Purchases fill Debit and payments Credit.
export const capitalOneCreditCard: CsvFormat = {
  id: "capital_one_credit_card",
  label: "Capital One credit card",
  account: { name: "Capital One card", kind: "credit_card" },
  requiredHeaders: [
    "transaction date",
    "posted date",
    "card no.",
    "description",
    "debit",
    "credit",
  ],
  parseRow(get) {
    return debitCreditRow(
      get("posted date"),
      get("description"),
      get("debit"),
      get("credit"),
      (value) => parseIsoDate(value) ?? parseUsDate(value),
      { bankCategory: optional(get("category")) },
    );
  },
};

// Capital One 360 checking and savings: "Account Number,Transaction Description,Transaction
// Date,Transaction Type,Transaction Amount,Balance", dates as MM/DD/YY. The amount has no
// sign; the type says Debit (money out) or Credit (money in).
export const capitalOne360: CsvFormat = {
  id: "capital_one_360",
  label: "Capital One 360 checking or savings",
  account: { name: "Capital One 360", kind: "checking" },
  requiredHeaders: [
    "transaction description",
    "transaction date",
    "transaction type",
    "transaction amount",
  ],
  parseRow(get) {
    const common = parseCommon(
      get("transaction date"),
      get("transaction amount"),
      get("transaction description"),
      (value) => parseShortUsDate(value) ?? parseUsDate(value),
    );
    if (!common.ok) return common;
    const type = get("transaction type").trim();
    if (!/^(debit|credit)$/i.test(type)) {
      return { ok: false, reason: `Unknown transaction type "${type}"` };
    }
    const cents = Math.abs(common.cents);
    return {
      ok: true,
      row: {
        date: common.date,
        amountCents: /^debit$/i.test(type) ? cents : -cents || 0,
        description: common.description,
        hints: { bankType: type },
      },
    };
  },
};

// Citi credit cards: "Status,Date,Description,Debit,Credit", with "Member Name" on cards
// with more than one card member. Purchases fill Debit; payments and refunds go under Credit
// with a minus sign.
export const citiCreditCard: CsvFormat = {
  id: "citi_credit_card",
  label: "Citi credit card",
  account: { name: "Citi card", kind: "credit_card" },
  requiredHeaders: ["status", "date", "description", "debit", "credit"],
  parseRow(get) {
    return debitCreditRow(
      get("date"),
      get("description"),
      get("debit"),
      get("credit"),
      parseUsDate,
      {
        bankType: optional(get("status")),
      },
    );
  },
};

// American Express: "Date,Description,Card Member,Account #,Amount", and with "additional
// details" ticked "Extended Details,Appears On Your Statement As,…,Category" after it.
// Charges are positive and payments negative.
export const amex: CsvFormat = {
  id: "amex",
  label: "American Express",
  account: { name: "American Express card", kind: "credit_card" },
  requiredHeaders: ["date", "description", "card member", "account #", "amount"],
  parseRow(get) {
    const common = parseCommon(get("date"), get("amount"), get("description"));
    if (!common.ok) return common;
    return {
      ok: true,
      row: {
        date: common.date,
        amountCents: common.cents,
        description: common.description,
        hints: { bankCategory: optional(get("category")) },
      },
    };
  },
};

// Discover cards: "Trans. Date,Post Date,Description,Amount,Category". Purchases are
// positive and payments negative.
export const discoverCreditCard: CsvFormat = {
  id: "discover_credit_card",
  label: "Discover card",
  account: { name: "Discover card", kind: "credit_card" },
  requiredHeaders: ["trans. date", "post date", "description", "amount", "category"],
  parseRow(get) {
    const common = parseCommon(get("post date"), get("amount"), get("description"));
    if (!common.ok) return common;
    return {
      ok: true,
      row: {
        date: common.date,
        amountCents: common.cents,
        description: common.description,
        hints: { bankCategory: optional(get("category")) },
      },
    };
  },
};

// Most specific first: a file matches the first format whose headers it all has.
export const CSV_FORMATS: readonly CsvFormat[] = [
  chaseChecking,
  chaseCreditCard,
  bankOfAmericaChecking,
  bankOfAmericaCreditCard,
  capitalOneCreditCard,
  capitalOne360,
  citiCreditCard,
  amex,
  discoverCreditCard,
];

export const HEADERLESS_FORMATS: readonly HeaderlessFormat[] = [wellsFargo];

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

export function detectFormat(headers: string[]): CsvFormat | null {
  const present = new Set(headers.map(normalizeHeader));
  return CSV_FORMATS.find((format) => format.requiredHeaders.every((h) => present.has(h))) ?? null;
}

// Bank of America puts a summary above the header row, so the header can be a few rows down.
export const HEADER_SEARCH_ROWS = 15;

export type Layout = {
  format: Pick<CsvFormat, "id" | "label" | "parseRow" | "account">;
  // Each column's name, as parseRow asks for it.
  columns: string[];
  rows: CsvRecord[];
};

// Which format a file is in: a header row near the top, else a headerless layout.
export function detectLayout(records: CsvRecord[]): Layout | null {
  for (const [i, record] of records.slice(0, HEADER_SEARCH_ROWS).entries()) {
    const format = detectFormat(record.fields);
    if (format) {
      return { format, columns: record.fields.map(normalizeHeader), rows: records.slice(i + 1) };
    }
  }
  const first = records[0]?.fields;
  const headerless = first && HEADERLESS_FORMATS.find((format) => format.matches(first));
  return headerless
    ? { format: headerless, columns: [...headerless.columns], rows: records }
    : null;
}
