import {
  CUSTOM_FORMAT,
  mappedLayout,
  mappingChoices,
  type ColumnMapping,
  type MappingChoices,
} from "./column-mapping";
import { PICK_COLUMNS } from "./messages";
import {
  closingBalances,
  controlTotals,
  statedTotals,
  type ControlReport,
  type DayBalance,
} from "./control-totals";
import { detectLayout, normalizeHeader, type CsvFormat, type ParsedRow } from "./formats";
import { parseCsv } from "./parse-csv";
import { looksLikeOfx, readOfx } from "@/data-sources/ofx/parse-ofx";
import { dedupeKeys } from "@/data-sources/dedupe";
import { normalizeMerchant } from "@/data-sources/merchant";
import { isAccountKind } from "@/data-sources/types";
import type {
  AccountKind,
  DataSource,
  NormalizedAccount,
  NormalizedTransaction,
  SkippedRow,
  SourceBatch,
} from "@/data-sources/types";

// Files are read into memory and never stored: callers pass the text, not a path. `mapping`:
// the columns the person picked, for a CSV in no bank's layout.
export type CsvFile = { name: string; text: string; mapping?: ColumnMapping };

// Why a file couldn't be read: in no layout we know (the person can pick its columns), not
// readable as CSV, or not a statement at all (a web page, a PDF, a spreadsheet).
export type CsvFailure = "unknown_format" | "unreadable" | "not_csv";

export const NO_TRANSACTIONS =
  "There are no transactions in it. Check the dates you picked when you downloaded it.";

export const REVERSED_MAPPING =
  "These amounts run against the file's own balance: money going out raises it, so spending would read as money coming in. Change which sign is spending.";

// The most rows a file is read for, and what to say past it. Everyone has this one: at the 4 MB an
// upload may be, far past years of statements. Someone with no account has a smaller one.
export type RowLimit = { rows: number; words: string };
export const NO_FILE_IS_THIS_LONG: RowLimit = {
  rows: 50_000,
  words: "This file has too many rows to read. Download fewer months from your bank.",
};
const RECORDS_NOT_ROWS = 20;

export const NOT_A_STATEMENT =
  "This isn't a CSV statement. Download the CSV from your bank's website.";

// Fewer columns than a date, a description and an amount: not a statement either.
const MIN_COLUMNS = 3;
const SNIFF_CHARS = 8192;
// Characters that don't occur in text: NULs, other control characters, bytes that weren't
// UTF-8. More than this share of them means a binary file.
const MAX_BINARY_SHARE = 0.01;

// Something saved or renamed as .csv that isn't one: a web page (a sign-in page saved by
// mistake), a PDF, an Excel file, an image.
export function notAStatement(text: string): boolean {
  const head = text.slice(0, SNIFF_CHARS);
  if (/^\s*(?:<!doctype html|<html|<head|<body)|<html[\s>]|<\/(?:div|table|script)>/i.test(head)) {
    return true;
  }
  if (head.startsWith("%PDF") || head.startsWith("PK\u0003\u0004")) return true;
  if (head.includes("\u0000")) return true;
  const odd = head.match(/[\u0001-\u0008\u000e-\u001f\ufffd]/g)?.length ?? 0;
  return head.length > 0 && odd / head.length > MAX_BINARY_SHARE;
}

export type CsvFileResult =
  | {
      ok: true;
      file: string;
      // The CSV format, or OFX/QFX (which has no columns to map).
      format: Pick<CsvFormat, "id" | "label" | "bank">;
      // The account a first upload of this file makes, before the person edits it.
      account: CsvFormat["account"];
      transactions: Omit<NormalizedTransaction, "accountRef">[];
      skipped: SkippedRow[];
      // The account's balance at the end of each day, from a running-balance column (empty
      // when the layout has none). For net worth over time (src/lib/import/balances.ts).
      balances?: DayBalance[];
      // Whether the file adds up (./control-totals.ts).
      control: ControlReport;
    }
  | {
      ok: false;
      file: string;
      error: string;
      reason: CsvFailure;
      // For an unknown layout: what the column picker offers.
      choices?: MappingChoices;
    };

export { closingBalances, type DayBalance };

// Words in a downloaded file's name that say nothing about the account.
const FILE_NOISE =
  /^(?:export|exported|statement|statements|transactions?|activity|download|history|csv|data|account|\d+|\d{4}-\d{2}(?:-\d{2})?)$/i;
const NAME_CHARS = 60;

// A name for a file's new account when its layout doesn't say whose it is: what's left of the
// file name ("golden1-export.csv" is "Golden1").
export function accountNameFromFile(fileName: string): string {
  const words = fileName
    .replace(/\.[a-z0-9]+$/i, "")
    // A browser's copy marker on a second download: "export (3).csv" (round 2 named one "(3)").
    .replace(/\s*\(\d+\)\s*$/, "")
    .split(/[\s._-]+/)
    .filter((w) => w && !FILE_NOISE.test(w));
  const name = words
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ")
    .slice(0, NAME_CHARS);
  return name || "Uploaded account";
}

export const OFX_FORMAT = { id: "ofx", label: "OFX or QFX statement" } as const;

// An OFX file says what kind of account it's from: a card statement, or a bank account's type,
// and its account number, whose last four tell two such accounts apart (round 3: a QFX file's
// account was just "Checking").
function ofxAccount(text: string): CsvFormat["account"] {
  const digits = /<ACCTID>\s*([^<\s]+)/i.exec(text)?.[1]?.replace(/\D/g, "") ?? "";
  const last4 = digits.length >= 4 ? ` ····${digits.slice(-4)}` : "";
  if (/<CCSTMTRS>/i.test(text)) return { name: `Credit card${last4}`, kind: "credit_card" };
  if (/<ACCTTYPE>\s*SAVINGS/i.test(text)) return { name: `Savings${last4}`, kind: "savings" };
  return { name: `Checking${last4}`, kind: "checking" };
}

// An export's summary rows under (or over) the transactions: "Total", "Ending balance". Skipped
// without a word (round 3: "2 rows will be skipped: Line 10: Unreadable date """). Their figures
// are checked against the rows (./control-totals.ts).
const SUMMARY_ROW = /^(?:(?:beginning|ending|opening|closing|available|current|ledger) balance)\b/i;
const TOTAL_ROW =
  /^(?:(?:totals?|summary)\s*:?\s*$|total (?:credits?|debits?|deposits?|withdrawals?|transactions|fees|interest|charges|payments|purchases)\b)/i;
// A row starting "Total" or "Summary" with more after it is a shop when it has a date: in a layout
// with the description first, "Total Wine" was dropped without a word (money rules, 11-03).
const NAMED_LIKE_A_TOTAL = /^(?:totals?|summary)\b/i;
const HAS_A_DAY = /^\s*(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\b/;

function isSummaryRow(fields: readonly string[]): boolean {
  const first = fields.find((value) => value.trim() !== "")?.trim() ?? "";
  if (SUMMARY_ROW.test(first) || TOTAL_ROW.test(first)) return true;
  return NAMED_LIKE_A_TOTAL.test(first) && !fields.some((value) => HAS_A_DAY.test(value));
}

// Reads one uploaded statement: a CSV export, or an OFX/QFX file (src/data-sources/ofx).
// `kind`: the account it's going into, once that's known.
export function readCsvFile(
  file: CsvFile,
  kind?: AccountKind,
  limit: RowLimit = NO_FILE_IS_THIS_LONG,
): CsvFileResult {
  if (looksLikeOfx(file.name, file.text)) {
    const result = readOfx(file, limit);
    return result.ok
      ? { ...result, format: OFX_FORMAT, account: ofxAccount(file.text) }
      : { ...result, reason: "unreadable" };
  }
  if (notAStatement(file.text)) {
    return { ok: false, file: file.name, error: NOT_A_STATEMENT, reason: "not_csv" };
  }
  let records;
  try {
    records = parseCsv(file.text);
  } catch (error) {
    return { ok: false, file: file.name, error: (error as Error).message, reason: "unreadable" };
  }
  if (records.length === 0) {
    return { ok: false, file: file.name, error: "The file is empty.", reason: "unreadable" };
  }
  // Stops here, before any row is read: the rest of the work grows with the rows. A few over, for
  // the header and a statement's summary lines; the caller counts the transactions themselves.
  if (records.length > limit.rows + RECORDS_NOT_ROWS) {
    return { ok: false, file: file.name, error: limit.words, reason: "unreadable" };
  }
  const detected = detectLayout(records);
  const mapped = !detected && file.mapping ? mappedLayout(records, file.mapping) : null;
  if (typeof mapped === "string") {
    return {
      ok: false,
      file: file.name,
      error: mapped,
      reason: "unknown_format",
      choices: mappingChoices(records),
    };
  }
  const layout = detected ?? mapped;
  if (!layout) {
    const width = Math.max(...records.slice(0, 20).map((r) => r.fields.length));
    if (width < MIN_COLUMNS) {
      return {
        ok: false,
        file: file.name,
        error: `This file has ${width === 1 ? "one column" : `${width} columns`}, and a statement needs at least a date, a description and an amount. Download the CSV from your bank's website.`,
        reason: "unreadable",
      };
    }
    return {
      ok: false,
      file: file.name,
      error: PICK_COLUMNS,
      reason: "unknown_format",
      choices: mappingChoices(records),
    };
  }

  const { format, columns, rows } = layout;
  const parsed: { line: number; row: ParsedRow }[] = [];
  const skipped: SkippedRow[] = [];
  let leftOut = 0;
  let repeatedHeaders = 0;
  const headerText = columns.join("|");
  for (const record of rows) {
    if (isSummaryRow(record.fields)) {
      leftOut += 1;
      continue;
    }
    if (detected && record.fields.map(normalizeHeader).join("|") === headerText) {
      repeatedHeaders += 1;
      leftOut += 1;
      continue;
    }
    // Chase adds a trailing comma to some rows; extra empty fields are harmless.
    const extra = record.fields.slice(columns.length);
    if (record.fields.length < columns.length && format.shortRows === "skip") {
      leftOut += 1;
      continue;
    }
    if (record.fields.length < columns.length || extra.some((value) => value.trim() !== "")) {
      skipped.push({
        file: file.name,
        line: record.line,
        reason: `Expected ${columns.length} columns, found ${record.fields.length}`,
      });
      continue;
    }
    const get = (name: string) => record.fields[columns.indexOf(name)] ?? "";
    const result = format.parseRow(get);
    if (result.ok) parsed.push({ line: record.line, row: result.row });
    else if (result.silent) leftOut += 1;
    else skipped.push({ file: file.name, line: record.line, reason: result.reason });
  }
  const unread = skipped.length;
  const everyRow = parsed.map((p) => p.row);

  // The format's last word on the rows as a whole (PayPal's card-paid pairs).
  if (format.finish) {
    const reasons = format.finish(parsed.map((p) => p.row));
    const kept = parsed.filter((p, i) => {
      const reason = reasons[i];
      if (reason) skipped.push({ file: file.name, line: p.line, reason });
      return !reason;
    });
    parsed.splice(0, parsed.length, ...kept);
  }
  const keys = dedupeKeys(parsed.map((p) => p.row));
  const transactions = parsed.map(({ row }, i) => ({
    date: row.date,
    amountCents: row.amountCents,
    description: row.description,
    merchantName: normalizeMerchant(row.merchant ?? row.description)?.name ?? null,
    categoryPrimary: null,
    categoryDetailed: null,
    pending: false,
    externalId: keys[i],
    hints: row.hints,
  }));
  // Column names and nothing under them (round 4: "Import 0 transactions").
  if (transactions.length === 0 && skipped.length === 0 && format.id !== CUSTOM_FORMAT.id) {
    return {
      ok: false,
      file: file.name,
      error: NO_TRANSACTIONS,
      reason: "unreadable",
    };
  }
  if (format.id === CUSTOM_FORMAT.id && transactions.length === 0) {
    return {
      ok: false,
      file: file.name,
      error: noRowsRead(skipped),
      reason: "unknown_format",
      choices: mappingChoices(records),
    };
  }
  // A column the person mapped may be a card's or a bank's: until they say, its signs can't be
  // called backwards. A known layout's account is its own.
  const custom = format.id === CUSTOM_FORMAT.id;
  const control = controlTotals({
    rows: everyRow,
    described: transactions,
    stated: statedTotals(records),
    counts: {
      inFile: rows.length,
      read: transactions.length,
      skipped: skipped.length,
      leftOut,
    },
    unread,
    repeatedHeaders,
    kind: kind ?? (custom ? null : format.account.kind),
  });
  // The columns the person picked run against the file's own balance: every figure would be
  // backwards, and they can change it. A bank's own layout has nothing to pick, so that warns.
  if (custom && kind && control.signsReversed) {
    return {
      ok: false,
      file: file.name,
      error: REVERSED_MAPPING,
      reason: "unknown_format",
      choices: mappingChoices(records),
    };
  }
  const closing = closingBalances(
    parsed.map((p) => p.row),
    control.balanceWay ?? "down",
  );
  return {
    ok: true,
    file: file.name,
    control,
    format: { id: format.id, label: format.label, bank: format.bank },
    account:
      format.id === CUSTOM_FORMAT.id
        ? { ...format.account, name: accountNameFromFile(file.name) }
        : format.account,
    transactions,
    skipped,
    balances: !control.balancesTrusted
      ? []
      : // A card's balance is what's owed, as everywhere: a file that writes it negative, falling
        // as money goes out, is turned round, or net worth would add the debt.
        custom && kind === "credit_card" && control.balanceWay === "down"
        ? closing.map((b) => ({ ...b, balanceCents: -b.balanceCents || 0 }))
        : closing,
  };
}

// What went wrong when the picked columns read nothing, in plain words: the first problem.
function noRowsRead(skipped: SkippedRow[]): string {
  const first = skipped[0];
  return first
    ? `None of the rows could be read with those columns. On line ${first.line}, ${first.reason}.`
    : "None of the rows could be read with those columns.";
}

export class CsvFormatError extends Error {
  constructor(readonly failures: { file: string; error: string }[]) {
    super(failures.map((f) => `${f.file}: ${f.error}`).join("\n"));
  }
}

// One CSV upload for one account the person picked or created on /import.
export class CsvDataSource implements DataSource {
  readonly kind = "csv" as const;

  constructor(
    private readonly account: NormalizedAccount,
    private readonly files: CsvFile[],
  ) {}

  // `files`: each file's format and how many transactions it had, for analytics. `balances`:
  // each day's closing balance from the files' running-balance columns (a later file wins).
  async load(): Promise<
    SourceBatch & {
      files: { format: string; rows: number }[];
      balances: DayBalance[];
      warnings: string[];
    }
  > {
    const kind = isAccountKind(this.account.kind) ? this.account.kind : undefined;
    const results = this.files.map((file) => readCsvFile(file, kind));
    const failures = results.flatMap((r) => (r.ok ? [] : [{ file: r.file, error: r.error }]));
    if (failures.length > 0) throw new CsvFormatError(failures);

    const batch = {
      accounts: [this.account],
      transactions: [] as SourceBatch["transactions"],
      skipped: [] as SourceBatch["skipped"],
      files: [] as { format: string; rows: number }[],
      balances: [] as DayBalance[],
      warnings: [] as string[],
    };
    const byDay = new Map<string, number>();
    for (const result of results) {
      if (!result.ok) continue;
      batch.files.push({ format: result.format.id, rows: result.transactions.length });
      for (const warning of result.control.warnings) {
        batch.warnings.push(
          this.files.length > 1 ? `${result.file}: ${warning.message}` : warning.message,
        );
      }
      for (const b of result.balances ?? []) byDay.set(b.date, b.balanceCents);
      // One by one: a very long file is too many arguments for a spread (a RangeError).
      for (const t of result.transactions) {
        batch.transactions.push({ ...t, accountRef: this.account.ref });
      }
      for (const skipped of result.skipped) batch.skipped.push(skipped);
    }
    batch.balances = [...byDay]
      .map(([date, balanceCents]) => ({ date, balanceCents }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return batch;
  }
}
