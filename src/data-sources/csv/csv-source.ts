import {
  CSV_FORMATS,
  detectFormat,
  normalizeHeader,
  type CsvFormat,
  type ParsedRow,
} from "./formats";
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

// Files are read into memory and never stored: callers pass the text, not a path.
export type CsvFile = { name: string; text: string };

export type CsvFileResult =
  | {
      ok: true;
      file: string;
      // The CSV format, or OFX/QFX (which has no columns to map).
      format: Pick<CsvFormat, "id" | "label">;
      transactions: Omit<NormalizedTransaction, "accountRef">[];
      skipped: SkippedRow[];
    }
  | { ok: false; file: string; error: string };

const SUPPORTED = CSV_FORMATS.map((format) => format.label).join(", ");

export const OFX_FORMAT = { id: "ofx", label: "OFX or QFX statement" } as const;

// Reads one uploaded statement: a CSV export, or an OFX/QFX file (src/data-sources/ofx).
export function readCsvFile(file: CsvFile): CsvFileResult {
  if (looksLikeOfx(file.name, file.text)) {
    const result = readOfx(file);
    return result.ok ? { ...result, format: OFX_FORMAT } : result;
  }
  let records;
  try {
    records = parseCsv(file.text);
  } catch (error) {
    return { ok: false, file: file.name, error: (error as Error).message };
  }
  if (records.length === 0) return { ok: false, file: file.name, error: "The file is empty." };

  const [header, ...rows] = records;
  const format = detectFormat(header.fields);
  if (!format) {
    return {
      ok: false,
      file: file.name,
      error: `We don't recognize this file's format. Supported exports: ${SUPPORTED}. The first row was: "${header.fields.join(", ").slice(0, 200)}".`,
    };
  }

  const columns = header.fields.map(normalizeHeader);
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
    else skipped.push({ file: file.name, line: record.line, reason: result.reason });
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
  return { ok: true, file: file.name, format, transactions, skipped };
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

  async load(): Promise<SourceBatch> {
    const results = this.files.map(readCsvFile);
    const failures = results.flatMap((r) => (r.ok ? [] : [{ file: r.file, error: r.error }]));
    if (failures.length > 0) throw new CsvFormatError(failures);

    const batch: SourceBatch = { accounts: [this.account], transactions: [], skipped: [] };
    for (const result of results) {
      if (!result.ok) continue;
      batch.transactions.push(
        ...result.transactions.map((t) => ({ ...t, accountRef: this.account.ref })),
      );
      batch.skipped.push(...result.skipped);
    }
    return batch;
  }
}
