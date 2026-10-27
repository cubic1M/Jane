"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { track } from "@/lib/analytics";
import { canImportCsv } from "@/lib/csv-access";
import { scopedDb, type ScopedDb } from "@/lib/db-scoped";
import { dismissImportRun } from "@/lib/import/background";
import { runJob } from "@/lib/jobs";
import { previewCsvFiles, type FilePreview } from "@/lib/import/import-csv";
import {
  NOT_ALLOWED,
  accountFields,
  createCsvAccountRow,
  readUploadFiles,
  saveUpload,
  uploadFailed,
} from "@/lib/import/upload";
import { requireUser } from "@/lib/session";

// The /import form: adding an account, the preview, and the import, which saves the rows and
// returns at once. The rest runs in the background (src/lib/import/background.ts) and the
// progress chip on every page follows it (src/components/import-chip.tsx).

export type ActionResult = { ok: true } | { ok: false; error: string };

// The scoped database for someone allowed to upload statements (see csv-access.ts), else null.
async function csvDb(): Promise<ScopedDb | null> {
  const user = await requireUser();
  return canImportCsv(user) ? scopedDb() : null;
}

export async function createCsvAccount(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const db = await csvDb();
  if (!db) return { ok: false, error: NOT_ALLOWED };
  const fields = accountFields(formData);
  if (typeof fields === "string") return { ok: false, error: fields };
  await createCsvAccountRow(db, fields);
  revalidatePath("/import");
  return { ok: true };
}

export type PreviewResult = { ok: true; files: FilePreview[] } | { ok: false; error: string };

export async function previewImport(formData: FormData): Promise<PreviewResult> {
  const db = await csvDb();
  if (!db) return { ok: false, error: NOT_ALLOWED };
  await track(db.userId, "upload_started");
  const files = await readUploadFiles(formData);
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

export type StartResult = { ok: true; runId: string; rows: number } | { ok: false; error: string };

export async function startImport(formData: FormData): Promise<StartResult> {
  const db = await csvDb();
  if (!db) return { ok: false, error: NOT_ALLOWED };
  const result = await saveUpload(db, formData);
  if (!result.ok) return result;
  // Started at once after the response; the jobs runner picks it up if this one is cut short.
  after(() => runJob(result.jobId).then(() => undefined));
  revalidatePath("/import");
  return { ok: true, runId: result.runId, rows: result.counts.inserted };
}

// Closing the chip once the person has seen how an upload went.
export async function dismissImport(runId: string): Promise<void> {
  const user = await requireUser();
  await dismissImportRun(user.id, runId);
}
