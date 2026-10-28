"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { track } from "@/lib/analytics";
import { canImportCsv } from "@/lib/csv-access";
import { scopedDb } from "@/lib/db-scoped";
import { refreshAfterUpload } from "@/lib/import/background";
import {
  importPositionsFiles,
  previewPositionsFiles,
  type PositionsFilePreview,
  type PositionsImportResult,
} from "@/lib/import/positions";
import { NOT_ALLOWED, readUploadFiles, uploadFailed } from "@/lib/import/upload";
import { requireUser } from "@/lib/session";

// The investments upload on /import/investments: a brokerage's positions download, previewed, then saved
// (src/lib/import/positions.ts). Its own page and actions, beside the statements upload.

async function positionsDb() {
  const user = await requireUser();
  return canImportCsv(user) ? scopedDb() : null;
}

export type PositionsPreviewResult =
  { ok: true; files: PositionsFilePreview[] } | { ok: false; error: string };

export async function previewPositions(formData: FormData): Promise<PositionsPreviewResult> {
  const db = await positionsDb();
  if (!db) return { ok: false, error: NOT_ALLOWED };
  await track(db.userId, "upload_started", { kind: "positions" });
  const files = await readUploadFiles(formData);
  if (!Array.isArray(files)) {
    await uploadFailed(db.userId, files.reason);
    return { ok: false, error: files.error };
  }
  const previews = await previewPositionsFiles(db, files);
  await Promise.all(
    previews.filter((p) => !p.ok).map(() => uploadFailed(db.userId, "unknown_format")),
  );
  return { ok: true, files: previews };
}

// The account types picked in the preview, by account key ("subtype.<key>").
function subtypesFrom(formData: FormData): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (name.startsWith("subtype.") && typeof value === "string") {
      picked[name.slice("subtype.".length)] = value;
    }
  }
  return picked;
}

export async function importPositions(formData: FormData): Promise<PositionsImportResult> {
  const db = await positionsDb();
  if (!db) return { ok: false, error: NOT_ALLOWED };
  const files = await readUploadFiles(formData);
  if (!Array.isArray(files)) {
    await uploadFailed(db.userId, files.reason);
    return { ok: false, error: files.error };
  }
  const result = await importPositionsFiles(db, files, { subtypes: subtypesFrom(formData) });
  if (!result.ok) {
    await uploadFailed(db.userId, "unknown_format");
    return result;
  }
  // The suggestions, snapshots and the rest see the new holdings, after the response.
  after(() => refreshAfterUpload(db.userId));
  revalidatePath("/import/investments");
  revalidatePath("/investments");
  return result;
}
