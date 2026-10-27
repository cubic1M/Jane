import {
  CUSTOM_FORMAT,
  mappedLayout,
  mappingChoices,
  type ColumnMapping,
  type MappingChoices,
} from "./column-mapping";
import { detectLayout, type CsvFormat, type ParsedRow } from "./formats";
import { parseCsv } from "./parse-csv";
import { looksLikeOfx, readOfx } from "@/data-sources/ofx/parse-ofx";
import { dedupeKeys } from "@/data-sources/dedupe";
import { normalizeMerchant } from "@/data-sources/merchant";
import type {
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
    }
  | {
      ok: false;
      file: string;
      error: string;
      reason: CsvFailure;
      // For an unknown layout: what the column picker offers.
      choices?: MappingChoices;
    };

export type DayBalance = { date: string; balanceCents: number };

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

// Each day's closing balance from a running-balance column. A running balance is the balance
// after its row, so the day's closing row is the one no other row of that day leads to: each
// row's balance before it (its balance plus what went out) is another row's balance after, all
// but the first's. That holds whatever order the rows of a day are listed in (import QA: a file
// newest-first by day but oldest-first within one). When it can't single one out (two rows that
// cancel out), the file's order decides: the first row seen when the file is newest first
// (Chase), the last when it's oldest first (Bank of America).
export function closingBalances(rows: readonly ParsedRow[]): DayBalance[] {
  const withBalance = rows.filter((r) => r.balanceCents !== undefined);
  if (withBalance.length === 0) return [];
  const newestFirst = withBalance[0].date > withBalance[withBalance.length - 1].date;
  const byDay = new Map<string, ParsedRow[]>();
  for (const row of withBalance) byDay.set(row.date, [...(byDay.get(row.date) ?? []), row]);
  return [...byDay]
    .map(([date, day]) => {
      // Money out is positive and lowered the balance: before = after + amount.
      const before = new Set(day.map((r) => r.balanceCents! + r.amountCents));
      const closing = day.filter((r) => !before.has(r.balanceCents!));
      const row = closing.length === 1 ? closing[0] : newestFirst ? day[0] : day[day.length - 1];
      return { date, balanceCents: row.balanceCents! };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
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
// without a word (round 3: "2 rows will be skipped: Line 10: Unreadable date """).
const SUMMARY_ROW =
  /^(?:totals?|(?:beginning|ending|opening|closing|available|current|ledger) balance|summary)\b/i;

// Reads one uploaded statement: a CSV export, or an OFX/QFX file (src/data-sources/ofx).
export function readCsvFile(file: CsvFile): CsvFileResult {
  if (looksLikeOfx(file.name, file.text)) {
    const result = readOfx(file);
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
      error: "Jane doesn't know this bank's layout yet. Pick which column is which below.",
      reason: "unknown_format",
      choices: mappingChoices(records),
    };
  }

  const { format, columns, rows } = layout;
  const parsed: { line: number; row: ParsedRow }[] = [];
  const skipped: SkippedRow[] = [];
  for (const record of rows) {
    if (SUMMARY_ROW.test(record.fields.find((value) => value.trim() !== "")?.trim() ?? ""))
      continue;
    // Chase adds a trailing comma to some rows; extra empty fields are harmless.
    const extra = record.fields.slice(columns.length);
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
    else if (!result.silent)
      skipped.push({ file: file.name, line: record.line, reason: result.reason });
  }

  const keys = dedupeKeys(parsed.map((p) => p.row));
  const transactions = parsed.map(({ row }, i) => ({
    date: row.date,
    amountCents: row.amountCents,
    description: row.description,
    merchantName: normalizeMerchant(row.description)?.name ?? null,
    categoryPrimary: null,
    categoryDetailed: null,
    pending: false,
    externalId: keys[i],
    hints: row.hints,
  }));
  if (format.id === CUSTOM_FORMAT.id && transactions.length === 0) {
    return {
      ok: false,
      file: file.name,
      error: noRowsRead(skipped),
      reason: "unknown_format",
      choices: mappingChoices(records),
    };
  }
  return {
    ok: true,
    file: file.name,
    format: { id: format.id, label: format.label, bank: format.bank },
    account:
      format.id === CUSTOM_FORMAT.id
        ? { ...format.account, name: accountNameFromFile(file.name) }
        : format.account,
    transactions,
    skipped,
    balances: closingBalances(parsed.map((p) => p.row)),
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
    SourceBatch & { files: { format: string; rows: number }[]; balances: DayBalance[] }
  > {
    const results = this.files.map(readCsvFile);
    const failures = results.flatMap((r) => (r.ok ? [] : [{ file: r.file, error: r.error }]));
    if (failures.length > 0) throw new CsvFormatError(failures);

    const batch = {
      accounts: [this.account],
      transactions: [] as SourceBatch["transactions"],
      skipped: [] as SourceBatch["skipped"],
      files: [] as { format: string; rows: number }[],
      balances: [] as DayBalance[],
    };
    const byDay = new Map<string, number>();
    for (const result of results) {
      if (!result.ok) continue;
      batch.files.push({ format: result.format.id, rows: result.transactions.length });
      for (const b of result.balances ?? []) byDay.set(b.date, b.balanceCents);
      batch.transactions.push(
        ...result.transactions.map((t) => ({ ...t, accountRef: this.account.ref })),
      );
      batch.skipped.push(...result.skipped);
    }
    batch.balances = [...byDay]
      .map(([date, balanceCents]) => ({ date, balanceCents }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return batch;
  }
}
