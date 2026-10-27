"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { mappingFromForm } from "@/data-sources/csv/column-mapping";
import { CsvFormatError, type CsvFile } from "@/data-sources/csv/csv-source";
import { NEW_ACCOUNT_ID } from "@/config/import";
import { ACCOUNT_KINDS, isAccountKind, type AccountKind } from "@/data-sources/types";
import { runDetection } from "@/detection/engine";
import { runJaneAgentSafely } from "@/lib/jane-agent/run";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { canImportCsv } from "@/lib/csv-access";
import { scopedDb, type ScopedDb } from "@/lib/db-scoped";
import { enqueueJob, runJob } from "@/lib/jobs";
import {
  AccountNotFoundError,
  MAX_FILE_BYTES,
  MAX_FILES,
  importCsvFiles,
  previewCsvFiles,
  type FilePreview,
} from "@/lib/import/import-csv";
import { parseMoneyToCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

const NOT_ALLOWED =
  "Uploading statements is for your own account. Sign up to upload yours; sample data can't.";

// The scoped database for someone allowed to upload statements (see csv-access.ts), else null.
async function csvDb(): Promise<ScopedDb | null> {
  const user = await requireUser();
  return canImportCsv(user) ? scopedDb() : null;
}

// upload_failed's reasons: only why, never the file or what's in it.
type UploadFailure =
  | "no_file"
  | "too_many"
  | "too_big"
  | "unknown_format"
  | "unreadable"
  | "not_csv"
  | "bad_columns"
  | "account_not_found"
  | "error";

const uploadFailed = (userId: string, reason: UploadFailure) =>
  track(userId, "upload_failed", { reason });

type AccountFields = { name: string; kind: AccountKind; balance: number | null };

// An account's name, type and (optional) balance from the form, with `prefix` for the
// new-account fields beside an upload ("new.name", …). A string says what's wrong.
function accountFields(formData: FormData, prefix = ""): AccountFields | string {
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

const createAccount = (db: ScopedDb, { name, kind, balance }: AccountFields) =>
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

export async function createCsvAccount(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const db = await csvDb();
  if (!db) return { ok: false, error: NOT_ALLOWED };
  const fields = accountFields(formData);
  if (typeof fields === "string") return { ok: false, error: fields };
  await createAccount(db, fields);
  revalidatePath("/import");
  return { ok: true };
}

type ReadFailure = { error: string; reason: UploadFailure };

// Reads uploads into memory, with the columns the person picked for any file in a layout we
// don't know. The raw files are never written anywhere.
async function readFiles(formData: FormData): Promise<CsvFile[] | ReadFailure> {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0)
    return { error: "Choose at least one statement file.", reason: "no_file" };
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

export type PreviewResult = { ok: true; files: FilePreview[] } | { ok: false; error: string };

export async function previewImport(formData: FormData): Promise<PreviewResult> {
  const db = await csvDb();
  if (!db) return { ok: false, error: NOT_ALLOWED };
  await track(db.userId, "upload_started");
  const files = await readFiles(formData);
  if (!Array.isArray(files)) {
    await uploadFailed(db.userId, files.reason);
    return { ok: false, error: files.error };
  }

  const previews = previewCsvFiles(files);
  await track(db.userId, "import_started", { files: files.length });
  const failed = previews.filter((p) => !p.ok);
  if (failed.length > 0) {
    await track(db.userId, "import_failed", { reason: "unknown_format", files: failed.length });
  }
  for (const preview of failed) await uploadFailed(db.userId, preview.reason);
  return { ok: true, files: previews };
}

export async function confirmImport(formData: FormData): Promise<ActionResult> {
  const db = await csvDb();
  if (!db) return { ok: false, error: NOT_ALLOWED };
  let accountId = String(formData.get("accountId") ?? "");
  const files = await readFiles(formData);
  if (!Array.isArray(files)) {
    await uploadFailed(db.userId, files.reason);
    return { ok: false, error: files.error };
  }

  // A first upload makes its account from the file (name and type suggested, balance
  // optional), once every file reads, so a failed upload leaves no empty account behind.
  let created = false;
  if (accountId === NEW_ACCOUNT_ID) {
    const fields = accountFields(formData, "new.");
    if (typeof fields === "string") return { ok: false, error: fields };
    const failed = previewCsvFiles(files).find((p) => !p.ok);
    if (failed && !failed.ok) {
      await uploadFailed(db.userId, failed.reason);
      return { ok: false, error: `${failed.file}: ${failed.error}` };
    }
    accountId = (await createAccount(db, fields)).id;
    created = true;
  }

  let result;
  try {
    result = await importCsvFiles(db, accountId, files);
  } catch (error) {
    if (created) await db.accounts.delete({ where: { id: accountId } });
    if (error instanceof CsvFormatError || error instanceof AccountNotFoundError) {
      const reason = error instanceof CsvFormatError ? "unknown_format" : "account_not_found";
      await track(db.userId, "import_failed", { reason });
      await uploadFailed(db.userId, reason);
      return { ok: false, error: error.message };
    }
    await track(db.userId, "import_failed", { reason: "error" });
    await uploadFailed(db.userId, "error");
    throw error;
  }

  const { files: imported, ...counts } = result;
  for (const file of imported) {
    await track(db.userId, "upload_succeeded", { format: file.format, rows: file.rows });
  }
  const metadata = { ...counts, files: files.length };
  await logAudit(
    { type: "user", id: db.userId },
    "import_completed",
    { type: "account", id: accountId },
    metadata,
  );
  await track(db.userId, "import_completed", metadata);

  // Card text from Claude takes a few seconds per finding, so it's written after the
  // response, as a job that's retried if it fails. Until then the report shows templates.
  const job = await enqueueJob("explain_findings", { userId: db.userId });
  const userId = db.userId;
  // Detection runs after the response too, so the tap answers at once: /scanning waits for a
  // first scan to finish, and a later import's findings come in as it does.
  after(async () => {
    try {
      await runDetection(userId);
    } catch (error) {
      // The import itself worked, so don't fail it. /scanning offers the report anyway.
      console.error("Detection failed after import", { error });
    }
    await runJob(job);
    // Then Jane says what's new in the chat (spec step 82).
    await runJaneAgentSafely(userId, { trigger: "import" });
  });
  redirect("/scanning");
}
