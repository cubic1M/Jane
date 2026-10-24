"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { CsvFormatError, type CsvFile } from "@/data-sources/csv/csv-source";
import { ACCOUNT_KINDS, isAccountKind } from "@/data-sources/types";
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

const NOT_ALLOWED = "CSV import is only for founders. Link your bank on the Accounts page.";

// The scoped database for someone allowed to import CSVs (see csv-access.ts), else null.
async function csvDb(): Promise<ScopedDb | null> {
  const user = await requireUser();
  const db = await scopedDb();
  return (await canImportCsv(user, db)) ? db : null;
}

export async function createCsvAccount(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const db = await csvDb();
  if (!db) return { ok: false, error: NOT_ALLOWED };
  const name = String(formData.get("name") ?? "").trim();
  const kind = formData.get("kind");
  const balanceText = String(formData.get("balance") ?? "").trim();

  if (!name || name.length > 60)
    return { ok: false, error: "Give the account a name (up to 60 characters)." };
  if (!isAccountKind(kind)) return { ok: false, error: "Pick checking, savings or credit card." };
  const balance = balanceText ? parseMoneyToCents(balanceText) : null;
  if (balanceText && balance === null) {
    return { ok: false, error: "Enter the balance as a number, like 1,234.56." };
  }

  await db.accounts.create({
    data: {
      userId: db.userId,
      source: "csv",
      name,
      type: ACCOUNT_KINDS[kind].type,
      subtype: ACCOUNT_KINDS[kind].subtype,
      currentBalanceCents: balance,
    },
  });
  revalidatePath("/import");
  return { ok: true };
}

// Reads uploads into memory. The raw files are never written anywhere.
async function readFiles(formData: FormData): Promise<CsvFile[] | string> {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return "Choose at least one CSV file.";
  if (files.length > MAX_FILES) return `Upload at most ${MAX_FILES} files at a time.`;
  const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
  if (tooBig) return `${tooBig.name} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
  return Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
}

export type PreviewResult = { ok: true; files: FilePreview[] } | { ok: false; error: string };

export async function previewImport(formData: FormData): Promise<PreviewResult> {
  const db = await csvDb();
  if (!db) return { ok: false, error: NOT_ALLOWED };
  const files = await readFiles(formData);
  if (typeof files === "string") return { ok: false, error: files };

  const previews = previewCsvFiles(files);
  await track(db.userId, "import_started", { files: files.length });
  const failed = previews.filter((p) => !p.ok).length;
  if (failed > 0) {
    await track(db.userId, "import_failed", { reason: "unknown_format", files: failed });
  }
  return { ok: true, files: previews };
}

export async function confirmImport(formData: FormData): Promise<ActionResult> {
  const db = await csvDb();
  if (!db) return { ok: false, error: NOT_ALLOWED };
  const accountId = String(formData.get("accountId") ?? "");
  const files = await readFiles(formData);
  if (typeof files === "string") return { ok: false, error: files };

  let counts;
  try {
    counts = await importCsvFiles(db, accountId, files);
  } catch (error) {
    if (error instanceof CsvFormatError || error instanceof AccountNotFoundError) {
      await track(db.userId, "import_failed", {
        reason: error instanceof CsvFormatError ? "unknown_format" : "account_not_found",
      });
      return { ok: false, error: error.message };
    }
    await track(db.userId, "import_failed", { reason: "error" });
    throw error;
  }

  const metadata = { ...counts, files: files.length };
  await logAudit(
    { type: "user", id: db.userId },
    "import_completed",
    { type: "account", id: accountId },
    metadata,
  );
  await track(db.userId, "import_completed", metadata);

  try {
    await runDetection(db.userId);
  } catch (error) {
    // The import itself worked, so don't fail it. /scanning waits for detection and offers
    // the report anyway if it doesn't finish.
    console.error("Detection failed after import", { error });
  }
  // Card text from Claude takes a few seconds per finding, so it's written after the
  // response, as a job that's retried if it fails. Until then the report shows templates.
  const job = await enqueueJob("explain_findings", { userId: db.userId });
  const userId = db.userId;
  after(async () => {
    await runJob(job);
    // Then Jane says what's new in the chat (spec step 82).
    await runJaneAgentSafely(userId, { trigger: "import" });
  });
  redirect("/scanning");
}
