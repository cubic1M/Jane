import { categorizeTransactions } from "@/categorize/categorize";
import type { MappingChoices } from "@/data-sources/csv/column-mapping";
import {
  CsvDataSource,
  readCsvFile,
  type CsvFailure,
  type CsvFile,
  type DayBalance,
} from "@/data-sources/csv/csv-source";
import { accountKindOf, type AccountKind, type SkippedRow } from "@/data-sources/types";
import type { ScopedDb } from "@/lib/db-scoped";

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
const SAMPLE_ROWS = 10;

export type FilePreview =
  | {
      file: string;
      ok: true;
      format: string;
      formatId: string;
      // The account a first upload of this file makes: its suggested name and type.
      account: { name: string; kind: AccountKind };
      rowCount: number;
      // The first and last day it covers (YYYY-MM-DD).
      from: string;
      to: string;
      skipped: SkippedRow[];
      sample: { date: string; description: string; amountCents: number }[];
    }
  | {
      file: string;
      ok: false;
      error: string;
      reason: CsvFailure;
      // An unknown layout: the column picker's choices.
      choices?: MappingChoices;
    };

// Parses in memory only; nothing is stored until the person confirms.
export function previewCsvFiles(files: CsvFile[]): FilePreview[] {
  return files.map((file) => {
    const result = readCsvFile(file);
    if (!result.ok) {
      const { file, error, reason, choices } = result;
      return { file, ok: false, error, reason, ...(choices ? { choices } : {}) };
    }
    const dates = result.transactions.map((t) => t.date).sort();
    return {
      file: result.file,
      ok: true,
      format: result.format.label,
      formatId: result.format.id,
      account: result.account,
      rowCount: result.transactions.length,
      from: dates[0] ?? "",
      to: dates[dates.length - 1] ?? "",
      skipped: result.skipped,
      sample: result.transactions.slice(0, SAMPLE_ROWS).map((t) => ({
        date: t.date,
        description: t.description,
        amountCents: t.amountCents,
      })),
    };
  });
}

export class AccountNotFoundError extends Error {
  constructor() {
    super("Pick one of your CSV accounts to import into.");
  }
}

export type ImportCounts = {
  parsed: number;
  inserted: number;
  duplicates: number;
  skipped: number;
};

// Each file's format and transaction count, for the upload_succeeded event.
export type ImportedFile = { format: string; rows: number };

// The steps of an upload after the files are read, for the progress bar on /import.
export type ImportStage = { stage: "sorting"; rows: number } | { stage: "saving" };

// Reads, sorts by the rules and saves an upload, and nothing more, so the tap answers at once:
// Claude's sorting of merchants no rule knows, card payments and everything worked out from the
// rows run afterwards, in the background (src/lib/import/background.ts).
export async function importCsvFiles(
  db: ScopedDb,
  accountId: string,
  files: CsvFile[],
  { onStage }: { onStage?: (stage: ImportStage) => void } = {},
): Promise<ImportCounts & { files: ImportedFile[]; balances: DayBalance[] }> {
  const account = await db.accounts.findUnique({ where: { id: accountId } });
  const kind = account && accountKindOf(account.type, account.subtype);
  if (!account || account.source !== "csv" || !kind) throw new AccountNotFoundError();

  const batch = await new CsvDataSource(
    {
      ref: account.id,
      name: account.name,
      kind,
      mask: account.mask,
      currentBalanceCents: account.currentBalanceCents,
    },
    files,
  ).load();
  // Overlapping files in one upload share rows; keep the first copy of each.
  const seen = new Set<string>();
  const unique = batch.transactions.filter((t) => {
    if (seen.has(t.externalId)) return false;
    seen.add(t.externalId);
    return true;
  });
  onStage?.({ stage: "sorting", rows: unique.length });
  const categorized = await categorizeTransactions(unique, db, { askClaude: false });

  onStage?.({ stage: "saving" });
  const { count } = await db.transactions.createMany({
    data: categorized.map((t) => ({
      userId: db.userId,
      accountId: account.id,
      source: "csv" as const,
      dedupeKey: t.externalId,
      date: new Date(`${t.date}T00:00:00Z`),
      amountCents: t.amountCents,
      description: t.description,
      merchantName: t.merchantName,
      pfcPrimary: t.category?.primary ?? null,
      pfcDetailed: t.category?.detailed ?? null,
      categorySource: t.categorySource,
      pending: t.pending,
    })),
    // Rows already imported (same account and dedupe key) are skipped by the database.
    skipDuplicates: true,
  });
  return {
    parsed: categorized.length,
    inserted: count,
    duplicates: categorized.length - count,
    skipped: batch.skipped.length,
    files: batch.files,
    balances: batch.balances,
  };
}
