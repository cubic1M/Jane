"use server";

import { revalidatePath } from "next/cache";
import { track } from "@/lib/analytics";
import { canImportCsv } from "@/lib/csv-access";
import { scopedDb, type ScopedDb } from "@/lib/db-scoped";
import { previewCsvFiles, type FilePreview } from "@/lib/import/import-csv";
import {
  NOT_ALLOWED,
  accountFields,
  createCsvAccountRow,
  readUploadFiles,
  uploadFailed,
} from "@/lib/import/upload";
import { requireUser } from "@/lib/session";

// The /import form's account and preview steps. Importing itself posts to /api/import, which
// streams each step to the progress bar (src/app/api/import/route.ts).

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
