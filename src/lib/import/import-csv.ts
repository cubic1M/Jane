import { categorizeTransactions } from "@/categorize/categorize";
import { CsvDataSource, readCsvFile, type CsvFile } from "@/data-sources/csv/csv-source";
import { accountKindOf, type SkippedRow } from "@/data-sources/types";
import type { ScopedDb } from "@/lib/db-scoped";

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
const SAMPLE_ROWS = 10;

export type FilePreview =
  | {
      file: string;
      ok: true;
      format: string;
      rowCount: number;
      skipped: SkippedRow[];
      sample: { date: string; description: string; amountCents: number }[];
    }
  | { file: string; ok: false; error: string };

// Parses in memory only; nothing is stored until the person confirms.
export function previewCsvFiles(files: CsvFile[]): FilePreview[] {
  return files.map((file) => {
    const result = readCsvFile(file);
    if (!result.ok) return { file: result.file, ok: false, error: result.error };
    return {
      file: result.file,
      ok: true,
      format: result.format.label,
      rowCount: result.transactions.length,
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

export async function importCsvFiles(
  db: ScopedDb,
  accountId: string,
  files: CsvFile[],
): Promise<ImportCounts> {
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
  const categorized = await categorizeTransactions(unique, db);

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
  };
}
