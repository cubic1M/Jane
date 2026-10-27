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

// Why a file couldn't be read: in no layout we know (the person can pick its columns), or
// not readable at all.
export type CsvFailure = "unknown_format" | "unreadable";

export type CsvFileResult =
  | {
      ok: true;
      file: string;
      // The CSV format, or OFX/QFX (which has no columns to map).
      format: Pick<CsvFormat, "id" | "label">;
      transactions: Omit<NormalizedTransaction, "accountRef">[];
      skipped: SkippedRow[];
    }
  | {
      ok: false;
      file: string;
      error: string;
      reason: CsvFailure;
      // For an unknown layout: what the column picker offers.
      choices?: MappingChoices;
    };

export const OFX_FORMAT = { id: "ofx", label: "OFX or QFX statement" } as const;

// Reads one uploaded statement: a CSV export, or an OFX/QFX file (src/data-sources/ofx).
export function readCsvFile(file: CsvFile): CsvFileResult {
  if (looksLikeOfx(file.name, file.text)) {
    const result = readOfx(file);
    return result.ok ? { ...result, format: OFX_FORMAT } : { ...result, reason: "unreadable" };
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

  const layout = detectLayout(records) ?? (file.mapping && mappedLayout(records, file.mapping));
  if (!layout) {
    return {
      ok: false,
      file: file.name,
      error: "We don't know this bank's layout yet. Pick which column is which below.",
      reason: "unknown_format",
      choices: mappingChoices(records),
    };
  }

  const { format, columns, rows } = layout;
  const parsed: { line: number; row: ParsedRow }[] = [];
  const skipped: SkippedRow[] = [];
  for (const record of rows) {
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
      error: "No rows could be read with those columns. Check the date and amount columns.",
      reason: "unknown_format",
      choices: mappingChoices(records),
    };
  }
  return {
    ok: true,
    file: file.name,
    format: { id: format.id, label: format.label },
    transactions,
    skipped,
  };
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

  // `files`: each file's format and how many transactions it had, for analytics.
  async load(): Promise<SourceBatch & { files: { format: string; rows: number }[] }> {
    const results = this.files.map(readCsvFile);
    const failures = results.flatMap((r) => (r.ok ? [] : [{ file: r.file, error: r.error }]));
    if (failures.length > 0) throw new CsvFormatError(failures);

    const batch = {
      accounts: [this.account],
      transactions: [] as SourceBatch["transactions"],
      skipped: [] as SourceBatch["skipped"],
      files: [] as { format: string; rows: number }[],
    };
    for (const result of results) {
      if (!result.ok) continue;
      batch.files.push({ format: result.format.id, rows: result.transactions.length });
      batch.transactions.push(
        ...result.transactions.map((t) => ({ ...t, accountRef: this.account.ref })),
      );
      batch.skipped.push(...result.skipped);
    }
    return batch;
  }
}
