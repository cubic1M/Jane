import type { PrismaClient } from "@/generated/prisma/client";
import type { DocumentKind } from "@/config/documents";
import { anthropic, llmModel } from "@/lib/anthropic";
import { logAudit } from "@/lib/audit";
import { decryptBytes, encryptBytes } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { readDocumentFacts } from "./extract";
import { factsFromForm, type RawFacts } from "./facts";
import { checkUpload, type UploadFile } from "./validate";

// Keeping, reading back and deleting the person's documents (spec step 68). Files are
// encrypted before they reach the database and are only decrypted for their owner. Never
// log a file, its name or its facts: they describe the person's life.

type Options = { client?: PrismaClient; claude?: typeof anthropic };

// What the list shows: everything but the file itself.
export const DOCUMENT_SELECT = {
  id: true,
  kind: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  provider: true,
  policyType: true,
  coverageSummary: true,
  premiumCents: true,
  premiumFrequency: true,
  renewalDate: true,
  warrantyEndsOn: true,
  purchaseDate: true,
  purchaseAmountCents: true,
  extractionSource: true,
  uploadedAt: true,
  updatedAt: true,
} as const;

export type UploadResult =
  | { ok: true; id: string; read: "claude" | "you"; summaryRejected: boolean }
  | { ok: false; error: string };

export async function addDocument(
  userId: string,
  upload: { file: UploadFile; bytes: Uint8Array; kind: DocumentKind },
  { client = defaultClient, claude = anthropic }: Options = {},
): Promise<UploadResult> {
  const db = scopedFor(userId, client);
  const check = checkUpload(upload.file, upload.bytes, await db.documents.count());
  if (!check.ok) return check;

  const document = await db.documents.create({
    data: {
      userId,
      kind: upload.kind,
      fileName: check.fileName,
      contentType: check.contentType,
      sizeBytes: upload.bytes.length,
      encryptedBytes: encryptBytes(upload.bytes),
    },
    select: { id: true },
  });
  const actor = { type: "user" as const, id: userId };
  const target = { type: "document", id: document.id };
  await logAudit(actor, "document_uploaded", target, {
    kind: upload.kind,
    content_type: check.contentType,
    size_bytes: upload.bytes.length,
  });

  const read = await readDocumentFacts(
    { bytes: upload.bytes, contentType: check.contentType, kind: upload.kind },
    { claude },
  );
  if (read.kind !== "claude") {
    if (read.kind === "failed") console.warn("Reading a document failed", { reason: read.reason });
    return { ok: true, id: document.id, read: "you", summaryRejected: false };
  }
  await db.documents.update({
    where: { id: document.id },
    data: { ...read.facts, extractionSource: "claude" },
  });
  // The file went to Claude: record that, and which model, never what it said.
  await logAudit(actor, "document_read", target, {
    model: llmModel(),
    summary_rejected: read.summaryRejected,
  });
  return { ok: true, id: document.id, read: "claude", summaryRejected: read.summaryRejected };
}

export type SaveResult = { ok: true } | { ok: false; error: string };

// The person's own facts, replacing whatever was there.
export async function saveDocumentFacts(
  userId: string,
  documentId: string,
  raw: RawFacts,
  { client = defaultClient }: Options = {},
): Promise<SaveResult> {
  const db = scopedFor(userId, client);
  const document = await db.documents.findFirst({
    where: { id: documentId },
    select: { id: true, kind: true },
  });
  if (!document) return { ok: false, error: "That file is gone. Refresh the page." };
  const parsed = factsFromForm(document.kind as DocumentKind, raw);
  if (!parsed.ok) return parsed;
  await db.documents.update({
    where: { id: document.id },
    data: { ...parsed.facts, extractionSource: "you" },
  });
  await logAudit({ type: "user", id: userId }, "document_facts_saved", {
    type: "document",
    id: document.id,
  });
  return { ok: true };
}

// True when a document was deleted.
export async function removeDocument(
  userId: string,
  documentId: string,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  const db = scopedFor(userId, client);
  const { count } = await db.documents.deleteMany({ where: { id: documentId } });
  if (count === 0) return false;
  await logAudit({ type: "user", id: userId }, "document_deleted", {
    type: "document",
    id: documentId,
  });
  return true;
}

// The decrypted file for its owner, or null for anyone else (and for a missing id).
export async function openDocument(
  userId: string,
  documentId: string,
  { client = defaultClient }: Options = {},
): Promise<{ fileName: string; contentType: string; bytes: Buffer } | null> {
  const db = scopedFor(userId, client);
  const document = await db.documents.findFirst({
    where: { id: documentId },
    select: { id: true, fileName: true, contentType: true, encryptedBytes: true },
  });
  if (!document) return null;
  const bytes = decryptBytes(document.encryptedBytes);
  await logAudit({ type: "user", id: userId }, "document_viewed", {
    type: "document",
    id: document.id,
  });
  return { fileName: document.fileName, contentType: document.contentType, bytes };
}
