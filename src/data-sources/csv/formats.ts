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
  // The merchant's name where the export gives one of its own (Apple Card's Merchant column):
  // cleaner than the description's ("SPOTIFY P2D3F STOCKHOLM" is "Spotify"; debugger 10-31).
  merchant?: string;
  hints: { bankCategory?: string; bankType?: string };
  // The account's balance after this row, where the export has a running-balance column.
  balanceCents?: number;
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
  // The bank whose export this is (none for a layout the person mapped): /import says so when
  // the file is going into an account named for another bank.
  bank?: string;
  parseRow(get: (header: string) => string): RowResult;
  // Rows with fewer columns than the header are a title or a note (Venmo's disclaimer), left
  // out quietly instead of reported.
  shortRows?: "skip";
  // After every row is read: a reason to leave each out, or null to keep it (PayPal: a payment
  // and the card deposit that paid for it).
  finish?(rows: readonly ParsedRow[]): (string | null)[];
};

// An export with no header row (Wells Fargo): names for its columns in order, and a test the
// first row must pass.
export type HeaderlessFormat = Omit<CsvFormat, "requiredHeaders"> & {
  columns: readonly string[];
  matches(fields: string[]): boolean;
};

// MM/DD/YYYY, as US banks export it, to YYYY-MM-DD.
export function parseUsDate(value: string): string | null {
  // A two-digit year is 20YY: Excel writes 10/23/26 when a downloaded statement is opened and
  // saved again (night QA 10-30: every row "Unreadable date", nothing imported).
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, month, day, written] = match.map(Number);
  const year = match[3].length === 2 ? 2000 + written : written;
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

// A running-balance column's value, or nothing when it's empty or unreadable.
function balanceOf(text: string): { balanceCents?: number } {
  const cents = text.trim() ? parseMoneyToCents(text) : null;
  return cents === null ? {} : { balanceCents: cents };
}

// Chase checking and savings: "Details,Posting Date,Description,Amount,Type,Balance,
// Check or Slip #". Amounts are negative for money leaving the account.
export const chaseChecking: CsvFormat = {
  id: "chase_checking",
  bank: "Chase",
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
        ...balanceOf(get("balance")),
      },
    };
  },
};

// Chase credit cards: "Transaction Date,Post Date,Description,Category,Type,Amount,Memo".
// Purchases are negative and payments or refunds positive.
export const chaseCreditCard: CsvFormat = {
  id: "chase_credit_card",
  bank: "Chase",
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
  bank: "Bank of America",
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
        ...balanceOf(get("running bal.")),
      },
    };
  },
};

// Bank of America credit cards: "Posted Date,Reference Number,Payee,Address,Amount".
// Purchases are negative and payments positive.
export const bankOfAmericaCreditCard: CsvFormat = {
  id: "bofa_credit_card",
  bank: "Bank of America",
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
  bank: "Wells Fargo",
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
  bank: "Capital One",
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
  bank: "Capital One",
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
        ...balanceOf(get("balance")),
      },
    };
  },
};

// Citi credit cards: "Status,Date,Description,Debit,Credit", with "Member Name" on cards
// with more than one card member. Purchases fill Debit; payments and refunds go under Credit
// with a minus sign.
export const citiCreditCard: CsvFormat = {
  id: "citi_credit_card",
  bank: "Citi",
  label: "Citi credit card",
  account: { name: "Citi card", kind: "credit_card" },
  requiredHeaders: ["status", "date", "description", "debit", "credit"],
  parseRow(get) {
    // A pending charge comes again as Cleared in the next export, often a day later or with the
    // tip added, so keeping both counted it twice (accuracy bench). Left out until it clears.
    if (/^pending$/i.test(get("status").trim())) {
      return { ok: false, reason: "Still pending", silent: true };
    }
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
  bank: "American Express",
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
  bank: "Discover",
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

// Apple Card (Wallet → Card Balance → a month's statement → Export Transactions → CSV):
// "Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD)", newer exports
// with "Purchased By" after it. Purchases are positive; payments and returns negative.
export const appleCard: CsvFormat = {
  id: "apple_card",
  bank: "Apple",
  label: "Apple Card",
  account: { name: "Apple Card", kind: "credit_card" },
  requiredHeaders: [
    "transaction date",
    "clearing date",
    "description",
    "merchant",
    "category",
    "type",
    "amount (usd)",
  ],
  parseRow(get) {
    const common = parseCommon(
      get("clearing date") || get("transaction date"),
      get("amount (usd)"),
      get("description"),
    );
    if (!common.ok) return common;
    return {
      ok: true,
      row: {
        date: common.date,
        amountCents: common.cents,
        description: common.description,
        ...(get("merchant").trim() ? { merchant: get("merchant").trim() } : {}),
        hints: { bankCategory: optional(get("category")), bankType: optional(get("type")) },
      },
    };
  },
};

// Up to four decimal places ("-12.3400", U.S. Bank's older exports) to cents.
function roundedCents(text: string): number | null {
  const match = /^\s*(-?)\$?(\d+(?:,\d{3})*)\.(\d{3,4})\s*$/.exec(text);
  if (!match) return parseMoneyToCents(text);
  const value = Number(`${match[2].replaceAll(",", "")}.${match[3]}`);
  const cents = Math.round(value * 100);
  return (match[1] ? -cents : cents) || 0;
}

// U.S. Bank checking and savings: "Date,Transaction,Name,Memo,Amount". Dates as YYYY-MM-DD in
// current exports and M/D/YYYY in older ones, older amounts with four decimals. Money out is
// negative; Memo is the same filler on every row ("Download from usbank.com."), so the name is
// the description.
export const usBank: CsvFormat = {
  id: "us_bank",
  bank: "US Bank",
  label: "U.S. Bank",
  account: { name: "US Bank checking", kind: "checking" },
  requiredHeaders: ["date", "transaction", "name", "memo", "amount"],
  parseRow(get) {
    const date = parseIsoDate(get("date")) ?? parseUsDate(get("date"));
    if (!date) return { ok: false, reason: `Unreadable date "${get("date")}"` };
    const cents = roundedCents(get("amount"));
    if (cents === null) return { ok: false, reason: `Unreadable amount "${get("amount")}"` };
    const description = get("name").trim();
    if (!description) return { ok: false, reason: "Missing description" };
    return {
      ok: true,
      row: {
        date,
        amountCents: -cents || 0,
        description,
        hints: { bankType: optional(get("transaction")) },
      },
    };
  },
};

// Ally Bank: "Date, Time, Amount, Type, Description", a space after every comma, dates as
// YYYY-MM-DD and the clock time in a column of its own. Withdrawals are negative.
export const ally: CsvFormat = {
  id: "ally",
  bank: "Ally",
  label: "Ally Bank",
  account: { name: "Ally savings", kind: "savings" },
  requiredHeaders: ["date", "time", "amount", "type", "description"],
  parseRow(get) {
    const common = parseCommon(
      get("date"),
      get("amount"),
      get("description"),
      (value) => parseIsoDate(value) ?? parseUsDate(value),
    );
    if (!common.ok) return common;
    return {
      ok: true,
      row: {
        date: common.date,
        amountCents: -common.cents || 0,
        description: common.description,
        hints: { bankType: optional(get("type")) },
      },
    };
  },
};

// Schwab Bank checking (History → Export): "Date,Status,Type,CheckNumber,Description,Withdrawal,
// Deposit,RunningBalance" (older exports have no Status). A date can read "09/20/2026 as of
// 09/18/2026": the first is the day it posted. Pending rows come again once posted.
export const schwabBank: CsvFormat = {
  id: "schwab_bank",
  bank: "Schwab",
  label: "Schwab Bank checking",
  account: { name: "Schwab checking", kind: "checking" },
  requiredHeaders: ["date", "type", "description", "withdrawal", "deposit", "runningbalance"],
  parseRow(get) {
    if (/^pending$/i.test(get("status").trim())) {
      return { ok: false, reason: "Still pending", silent: true };
    }
    const result = debitCreditRow(
      get("date")
        .trim()
        .split(/\s+as of\s+/i)[0],
      get("description"),
      get("withdrawal"),
      get("deposit"),
      parseUsDate,
      { bankType: optional(get("type")) },
    );
    return result.ok
      ? { ok: true, row: { ...result.row, ...balanceOf(get("runningbalance")) } }
      : result;
  },
};

// Navy Federal Credit Union (an account's transactions → Download, CSV): "Posting Date,
// Transaction Date,Amount,Credit Debit Indicator,type,Type Group,Reference,…,Description,
// Category". Every amount is positive; the indicator says which way it went (night QA 10-30:
// the column picker had no way to say so, so pay would have read as spending).
export const navyFederal: CsvFormat = {
  id: "navy_federal",
  bank: "Navy Federal",
  label: "Navy Federal Credit Union",
  account: { name: "Navy Federal checking", kind: "checking" },
  requiredHeaders: ["posting date", "amount", "credit debit indicator", "description"],
  parseRow(get) {
    const common = parseCommon(get("posting date"), get("amount"), get("description"));
    if (!common.ok) return common;
    const way = get("credit debit indicator").trim().toLowerCase();
    if (way !== "credit" && way !== "debit") {
      return { ok: false, reason: `Unreadable credit or debit "${get("credit debit indicator")}"` };
    }
    const cents = Math.abs(common.cents);
    return {
      ok: true,
      row: {
        date: common.date,
        // Plaid's sign: money out is positive.
        amountCents: way === "debit" ? cents : -cents,
        description: common.description,
        hints: { bankType: optional(get("type")), bankCategory: optional(get("category")) },
      },
    };
  },
};

// "- $25.00" or "+ $1,200.00" (Venmo) to cents, the sign kept.
function spacedSignCents(text: string): number | null {
  return parseMoneyToCents(text.replace(/\s+/g, "").replace(/^\+/, ""));
}

// Venmo statements (Statements → Download CSV): a title line, then ",ID,Datetime,Type,Status,
// Note,From,To,Amount (total),…,Funding Source,Destination,…" (newer: "Transaction ID,Date,
// Time (UTC),…"). Money sent is "- $25.00", received "+ $40.00". Balance and disclaimer lines
// have no ID. A payment paid from a bank or card stays: that statement shows it as a Venmo
// transfer, not spending, so it counts once, here, with its note.
export const venmo: CsvFormat = {
  id: "venmo",
  bank: "Venmo",
  label: "Venmo",
  account: { name: "Venmo", kind: "payment_app" },
  requiredHeaders: ["type", "status", "note", "from", "to", "amount (total)"],
  shortRows: "skip",
  parseRow(get) {
    const id = (get("id") || get("transaction id")).trim();
    const when = (get("datetime") || get("date")).trim();
    if (!id || !when) return { ok: false, reason: "Not a transaction", silent: true };
    if (!/^(complete|issued)/i.test(get("status").trim())) {
      return {
        ok: false,
        reason: `Not completed (${get("status").trim() || "no status"})`,
        silent: true,
      };
    }
    const date = parseIsoDate(when.slice(0, 10)) ?? parseUsDate(when.split(/\s+/)[0]);
    if (!date) return { ok: false, reason: `Unreadable date "${when}"` };
    const cents = spacedSignCents(get("amount (total)"));
    if (cents === null)
      return { ok: false, reason: `Unreadable amount "${get("amount (total)")}"` };
    const type = get("type").trim();
    const note = get("note").trim();
    // Sent: to whom; received: from whom. A transfer out to the bank says so.
    const who = (cents < 0 ? get("to") : get("from")).trim();
    const description = /transfer/i.test(type)
      ? `Transfer to bank${note ? `: ${note}` : ""}`
      : [who, note].filter(Boolean).join(": ") || type;
    if (!description) return { ok: false, reason: "Missing description" };
    // Venmo's "Payment" and "Charge" are payments between people, not a bank's "Payment" type
    // (paying a card): passing them on made a roommate's rent share a card payment (debugger
    // 10-30). Other types (transfers) still go through.
    const p2p = /^(?:payment|charge)$/i.test(type);
    return {
      ok: true,
      row: {
        date,
        amountCents: -cents || 0,
        description,
        hints: p2p ? {} : { bankType: optional(type) },
      },
    };
  },
};

// PayPal (Activity → Download, CSV): "Date","Time","TimeZone","Name","Type","Status","Currency",
// "Gross","Fee","Net",…. Net is what moved the PayPal balance; money out is negative. Only
// completed US-dollar rows count.
export const paypal: CsvFormat = {
  id: "paypal",
  bank: "PayPal",
  label: "PayPal",
  account: { name: "PayPal", kind: "payment_app" },
  requiredHeaders: [
    "date",
    "time",
    "timezone",
    "name",
    "type",
    "status",
    "currency",
    "gross",
    "net",
  ],
  parseRow(get) {
    if (!/^completed$/i.test(get("status").trim())) {
      return {
        ok: false,
        reason: `Not completed (${get("status").trim() || "no status"})`,
        silent: true,
      };
    }
    const currency = get("currency").trim().toUpperCase();
    if (currency && currency !== "USD") {
      return { ok: false, reason: `In ${currency}, not US dollars` };
    }
    const type = get("type").trim();
    // Money moved to or from the bank has no name: said as a transfer, so it isn't spending.
    const moved = /withdrawal/i.test(type)
      ? "Transfer to bank"
      : /deposit/i.test(type)
        ? "Transfer from bank"
        : type;
    const common = parseCommon(get("date"), get("net") || get("gross"), get("name") || moved);
    if (!common.ok) return common;
    return {
      ok: true,
      row: {
        date: common.date,
        amountCents: -common.cents || 0,
        description: common.description,
        hints: { bankType: optional(type) },
        ...balanceOf(get("balance")),
      },
    };
  },
  // A purchase paid by card or bank comes as two rows: the card's deposit into PayPal and the
  // payment, same day, same amount. The card or bank statement already has that charge, so
  // both are left out; a payment from the PayPal balance stays.
  finish(rows) {
    const reasons: (string | null)[] = rows.map(() => null);
    const deposit = (row: ParsedRow) =>
      /deposit/i.test(row.hints.bankType ?? "") && row.amountCents < 0;
    rows.forEach((row, i) => {
      if (!deposit(row)) return;
      const paid = rows.findIndex(
        (other, j) =>
          reasons[j] === null &&
          j !== i &&
          !deposit(other) &&
          other.date === row.date &&
          other.amountCents === -row.amountCents,
      );
      if (paid === -1) return;
      reasons[i] = reasons[paid] = "Paid by card or bank: that statement has it";
    });
    return reasons;
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
  appleCard,
  usBank,
  ally,
  schwabBank,
  navyFederal,
  venmo,
  paypal,
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
  format: Pick<
    CsvFormat,
    "id" | "label" | "parseRow" | "account" | "bank" | "shortRows" | "finish"
  >;
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
