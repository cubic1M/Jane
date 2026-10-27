import { matchCardPayments } from "@/categorize/card-payments";
import { categorizeLeftovers } from "@/categorize/categorize";
import { NEW_ACCOUNT_ID } from "@/config/import";
import { mappingFromForm } from "@/data-sources/csv/column-mapping";
import { CsvFormatError, type CsvFile } from "@/data-sources/csv/csv-source";
import { ACCOUNT_KINDS, isAccountKind, type AccountKind } from "@/data-sources/types";
import { runDetection } from "@/detection/engine";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { scopedFor, type ScopedDb } from "@/lib/db-scoped";
import {
  AccountNotFoundError,
  MAX_FILE_BYTES,
  MAX_FILES,
  importCsvFiles,
  previewCsvFiles,
  type ImportCounts,
  type ImportStage,
} from "@/lib/import/import-csv";
import { runJaneAgentSafely } from "@/lib/jane-agent/run";
import { enqueueJob, runJob } from "@/lib/jobs";
import { parseMoneyToCents } from "@/lib/money";

// Uploading statements on /import: reading the files from the form, the account a first
// upload makes, saving, and what runs once it's saved. Shared by the server actions
// (src/app/import/actions.ts) and the upload route that streams its progress
// (src/app/api/import/route.ts). Files are read into memory and never stored.

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
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return { error: "Choose at least one statement file.", reason: "no_file" };
  }
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
  const read: CsvFile[] = [];
  for (const [i, f] of files.entries()) {
    const mapping = mappingFromForm(formData, i);
    if (typeof mapping === "string") {
      return { error: `${f.name}: ${mapping}`, reason: "bad_columns" };
    }
    read.push({ name: f.name, text: await f.text(), ...(mapping ? { mapping } : {}) });
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
  | { ok: true; accountId: string; counts: ImportCounts; jobId: string }
  | { ok: false; error: string };

// Saves an upload from the /import form: reads the files, makes the account for a first
// upload (once every file reads, so a failed upload leaves no empty account), sorts and saves
// the rows, and records it. `onStage` hears each step as it starts.
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

  let result;
  try {
    result = await importCsvFiles(db, accountId, files, { onStage });
  } catch (error) {
    if (created) await db.accounts.delete({ where: { id: accountId } });
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

  const { files: imported, ...counts } = result;
  const metadata = { ...counts, files: files.length };
  // Independent writes, so at once: each is a round trip to the database (and PostHog).
  const [, , job] = await Promise.all([
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
    // Card text from Claude takes a few seconds per finding, so it's written after the
    // response, as a job that's retried if it fails. Until then the report shows templates.
    enqueueJob("explain_findings", { userId: db.userId }),
  ]);
  return { ok: true, accountId, counts, jobId: job };
}

// Looking for savings in what was just saved. The import itself worked, so a failure here
// doesn't fail it: the report shows what's there.
export async function detectAfterUpload(userId: string): Promise<boolean> {
  try {
    await runDetection(userId);
    return true;
  } catch (error) {
    console.error("Detection failed after import", { error });
    return false;
  }
}

// What runs once the person has their findings: Claude sorts the merchants no rule knew (and
// if that moved anything, the card payments and the findings are worked out again), writes the
// card text, and Jane says what's new in the chat (spec step 82).
export async function finishUpload(userId: string, jobId: string): Promise<void> {
  const db = scopedFor(userId);
  try {
    if ((await categorizeLeftovers(db)) > 0) {
      await matchCardPayments(db);
      await detectAfterUpload(userId);
    }
  } catch (error) {
    console.error("Sorting the rest of an upload failed", { error });
  }
  await runJob(jobId);
  await runJaneAgentSafely(userId, { trigger: "import" });
}
