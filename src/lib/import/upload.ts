import { MAX_UPLOAD_BYTES, NEW_ACCOUNT_ID, uploadTooBig } from "@/config/import";
import { mappingFromForm } from "@/data-sources/csv/column-mapping";
import { CsvFormatError, type CsvFile } from "@/data-sources/csv/csv-source";
import { decodeStatement } from "@/data-sources/csv/decode";
import { ACCOUNT_KINDS, isAccountKind, type AccountKind } from "@/data-sources/types";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import type { ScopedDb } from "@/lib/db-scoped";
import { keepFileBalances } from "@/lib/import/balances";
import {
  AccountNotFoundError,
  MAX_FILE_BYTES,
  MAX_FILES,
  importCsvFiles,
  previewCsvFiles,
  type ImportCounts,
  type ImportStage,
} from "@/lib/import/import-csv";
import { enqueueJob } from "@/lib/jobs";
import { parseMoneyToCents } from "@/lib/money";

// Uploading statements on /import: reading the files from the form, the account a first
// upload makes, and saving. Used by the server actions (src/app/import/actions.ts); what runs
// once it's saved is src/lib/import/background.ts. Files are read into memory and never stored.

export const NOT_ALLOWED =
  "Uploading statements is for your own account. Sign up to upload yours; sample data can't.";

// upload_failed's reasons: only why, never the file or what's in it.
export type UploadFailure =
  | "no_file"
  | "too_many"
  | "too_big"
  | "unknown_format"
  | "unreadable"
  | "not_csv"
  | "bad_columns"
  | "account_not_found"
  | "error";

export const uploadFailed = (userId: string, reason: UploadFailure) =>
  track(userId, "upload_failed", { reason });

type ReadFailure = { error: string; reason: UploadFailure };

// Reads uploads into memory, with the columns the person picked for any file in a layout we
// don't know. The raw files are never written anywhere.
export async function readUploadFiles(formData: FormData): Promise<CsvFile[] | ReadFailure> {
  const chosen = formData.getAll("files").filter((f): f is File => f instanceof File && !!f.name);
  if (chosen.length === 0) {
    return { error: "Choose at least one statement file.", reason: "no_file" };
  }
  // A file with nothing in it was chosen all the same (round 4 said "Choose at least one").
  const empty = chosen.find((f) => f.size === 0);
  if (empty) {
    return {
      error: `${empty.name} is empty. Download it again from your bank.`,
      reason: "unreadable",
    };
  }
  const files = chosen;
  if (files.length > MAX_FILES) {
    return { error: `Upload at most ${MAX_FILES} files at a time.`, reason: "too_many" };
  }
  const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
  if (tooBig) {
    return {
      error: `${tooBig.name} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
      reason: "too_big",
    };
  }
  const bytes = files.reduce((sum, f) => sum + f.size, 0);
  if (bytes > MAX_UPLOAD_BYTES) return { error: uploadTooBig(bytes), reason: "too_big" };
  const read: CsvFile[] = [];
  for (const [i, f] of files.entries()) {
    const mapping = mappingFromForm(formData, i);
    if (typeof mapping === "string") {
      return { error: `${f.name}: ${mapping}`, reason: "bad_columns" };
    }
    const text = decodeStatement(await f.arrayBuffer());
    read.push({ name: f.name, text, ...(mapping ? { mapping } : {}) });
  }
  return read;
}

type AccountFields = { name: string; kind: AccountKind; balance: number | null };

// An account's name, type and (optional) balance from the form, with `prefix` for the
// new-account fields beside an upload ("new.name", …). A string says what's wrong.
export function accountFields(formData: FormData, prefix = ""): AccountFields | string {
  const field = (name: string) => formData.get(`${prefix}${name}`);
  const name = String(field("name") ?? "").trim();
  const kind = field("kind");
  const balanceText = String(field("balance") ?? "").trim();

  if (!name || name.length > 60) return "Give the account a name (up to 60 characters).";
  if (!isAccountKind(kind)) return "Pick checking, savings or credit card.";
  const balance = balanceText ? parseMoneyToCents(balanceText) : null;
  if (balanceText && balance === null) return "Enter the balance as a number, like 1,234.56.";
  return { name, kind, balance };
}

export const createCsvAccountRow = (db: ScopedDb, { name, kind, balance }: AccountFields) =>
  db.accounts.create({
    data: {
      userId: db.userId,
      source: "csv",
      name,
      type: ACCOUNT_KINDS[kind].type,
      subtype: ACCOUNT_KINDS[kind].subtype,
      currentBalanceCents: balance,
    },
  });

export type UploadStage = { stage: "reading" } | ImportStage;

export type UploadResult =
  | { ok: true; accountId: string; counts: ImportCounts; runId: string; jobId: string }
  | { ok: false; error: string };

// Saves an upload from the /import form and queues the rest: reads the files, makes the account
// for a first upload (once every file reads, so a failed upload leaves no empty account), sorts
// the rows by the rules and saves them with the statement's balances, records it, and queues
// the import_finish job that does everything else. `onStage` hears each step as it starts.
export async function saveUpload(
  db: ScopedDb,
  formData: FormData,
  { onStage }: { onStage?: (stage: UploadStage) => void } = {},
): Promise<UploadResult> {
  onStage?.({ stage: "reading" });
  let accountId = String(formData.get("accountId") ?? "");
  const files = await readUploadFiles(formData);
  if (!Array.isArray(files)) {
    await uploadFailed(db.userId, files.reason);
    return { ok: false, error: files.error };
  }

  let created = false;
  if (accountId === NEW_ACCOUNT_ID) {
    const fields = accountFields(formData, "new.");
    if (typeof fields === "string") return { ok: false, error: fields };
    const failed = previewCsvFiles(files).find((p) => !p.ok);
    if (failed && !failed.ok) {
      await uploadFailed(db.userId, failed.reason);
      return { ok: false, error: `${failed.file}: ${failed.error}` };
    }
    accountId = (await createCsvAccountRow(db, fields)).id;
    created = true;
  }

  // The upload's record first, so each row it adds carries it (the upload history on /import).
  // Its account is set once the import has checked it's the person's own.
  const run = await db.importRuns.create({
    data: { userId: db.userId, rows: 0, fileNames: files.map((f) => f.name) },
    select: { id: true },
  });
  let result;
  try {
    result = await importCsvFiles(db, accountId, files, { onStage, importRunId: run.id });
  } catch (error) {
    if (created) await db.accounts.delete({ where: { id: accountId } });
    await db.importRuns.deleteMany({ where: { id: run.id } });
    if (error instanceof CsvFormatError || error instanceof AccountNotFoundError) {
      const reason = error instanceof CsvFormatError ? "unknown_format" : "account_not_found";
      await Promise.all([
        track(db.userId, "import_failed", { reason }),
        uploadFailed(db.userId, reason),
      ]);
      return { ok: false, error: error.message };
    }
    await Promise.all([
      track(db.userId, "import_failed", { reason: "error" }),
      uploadFailed(db.userId, "error"),
    ]);
    throw error;
  }

  const { files: imported, balances, from, to, ...counts } = result;
  const metadata = { ...counts, files: files.length };
  const day = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null);
  await Promise.all([
    // The statement's own closing balances, kept now: the files themselves are never stored.
    keepFileBalances(db, accountId, balances),
    db.importRuns.updateMany({
      where: { id: run.id },
      data: { accountId, rows: counts.inserted, fromDate: day(from), toDate: day(to) },
    }),
  ]);
  // Independent writes, so at once: each is a round trip to the database (and PostHog).
  const [, , jobId] = await Promise.all([
    logAudit(
      { type: "user", id: db.userId },
      "import_completed",
      { type: "account", id: accountId },
      metadata,
    ),
    Promise.all([
      track(db.userId, "import_completed", metadata),
      // The format and row count only: nothing from the file itself.
      ...imported.map((file) =>
        track(db.userId, "upload_succeeded", { format: file.format, rows: file.rows }),
      ),
    ]),
    // The rest runs in the background (src/lib/import/background.ts), retried if it fails.
    enqueueJob("import_finish", { userId: db.userId, importRunId: run.id }),
  ]);
  return { ok: true, accountId, counts, runId: run.id, jobId };
}
