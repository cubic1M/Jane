"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CsvFormatError, type CsvFile } from "@/data-sources/csv/csv-source";
import { ACCOUNT_KINDS, isAccountKind } from "@/data-sources/types";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { scopedDb } from "@/lib/db-scoped";
import {
  AccountNotFoundError,
  MAX_FILE_BYTES,
  MAX_FILES,
  importCsvFiles,
  previewCsvFiles,
  type FilePreview,
} from "@/lib/import/import-csv";
import { parseMoneyToCents } from "@/lib/money";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createCsvAccount(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const db = await scopedDb();
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
  const db = await scopedDb();
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
  const db = await scopedDb();
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
  redirect("/scanning");
}
