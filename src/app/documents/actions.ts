"use server";

import { adviceMode } from "@/lib/advice-mode";
import { readDraftReturn } from "@/lib/draft-return";
import { revalidatePath } from "next/cache";
import { documentTooBig, MAX_DOCUMENT_BYTES, type DocumentContentType } from "@/config/documents";
import { track } from "@/lib/analytics";
import { isDocumentKind, type RawFacts } from "@/lib/documents/facts";
import { addDocument, removeDocument, saveDocumentFacts } from "@/lib/documents/store";
import { log } from "@/lib/log";
import { readTaxNotice } from "@/lib/tax-notices";
import { readPriorReturn } from "@/lib/prior-return";
import { readPolicyDocument } from "@/lib/insurance/readings";
import { hit } from "@/lib/rate-limit";
import { isTrialUser } from "@/lib/trial-ids";
import { requireUser } from "@/lib/session";
import { isStatementTrialUser } from "@/lib/trial-ids";
import {
  DEMO_NO_DOCUMENTS,
  SAMPLE_NO_DOCUMENTS,
  STATEMENT_TRIAL_NO_DOCUMENTS,
} from "@/config/statement-trial";

// Uploading, correcting and deleting documents on /documents (spec step 68). The upload
// and facts forms keep their message on screen and refresh the list themselves, so these
// don't revalidate /documents; deleting has no message, so it does.

export type FormState = { ok: boolean; message: string } | null;

// The tax papers read on upload: the reader, what it's called in the log, and where to confirm it.
const TAX_READERS = {
  tax_notice: {
    read: (userId: string, id: string, options: { file: ReaderFile }) =>
      readTaxNotice(userId, id, options),
    what: "a tax notice",
    saved:
      "Saved. Check what Jane read on Letters from the IRS (Taxes) or in the chat, and confirm it.",
  },
  draft_return: {
    read: (userId: string, id: string, options: { file: ReaderFile }) =>
      readDraftReturn(userId, id, options),
    what: "a draft return",
    saved:
      "Saved. Check what Jane read on Your draft return (Taxes) or in the chat, and confirm it: then Jane checks it before you file.",
  },
  tax_return: {
    read: (userId: string, id: string, options: { file: ReaderFile }) =>
      readPriorReturn(userId, id, options),
    what: "a tax return",
    saved:
      "Saved. Check what Jane read on Last year's return (Taxes) or in the chat, and confirm it.",
  },
} as const;
type ReaderFile = { bytes: Uint8Array; contentType: DocumentContentType };

export async function uploadDocument(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  // Each document may go to Claude, and is stored: neither is for a temporary try.
  if (isStatementTrialUser(user.id)) return { ok: false, message: STATEMENT_TRIAL_NO_DOCUMENTS };
  if (isTrialUser(user.id)) return { ok: false, message: SAMPLE_NO_DOCUMENTS };
  // Only the demo bank here, so Jane gives sample advice, and a real return or policy would get it.
  if (await adviceMode(user.id)) return { ok: false, message: DEMO_NO_DOCUMENTS };
  if (!(await hit("documents", user.id)).ok) {
    return { ok: false, message: "That's a lot of uploads at once. Try again in an hour." };
  }
  const file = formData.get("file");
  const kind = formData.get("kind");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a file." };
  if (!isDocumentKind(kind)) return { ok: false, message: "Pick what kind of document it is." };
  // Checked again on the bytes; this stops an oversized file before it's read.
  if (file.size > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      message: documentTooBig(),
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await addDocument(user.id, {
    file: { name: file.name, type: file.type, size: file.size },
    bytes,
    kind,
  });
  if (!result.ok) return { ok: false, message: result.error };
  await track(user.id, "document_uploaded", { kind, read: result.read });
  const toRead = { bytes, contentType: file.type as DocumentContentType };
  // A tax paper is read for the person to confirm (a notice, step 217; a draft return, step
  // 272, then checked before filing; last year's return). The upload's stated type matched its
  // bytes, or it wasn't saved.
  const taxReader = TAX_READERS[kind as keyof typeof TAX_READERS];
  if (taxReader) {
    const reading = await taxReader.read(user.id, result.id, { file: toRead }).catch((error) => {
      log.error(`Reading ${taxReader.what} failed`, { error: String(error) });
      return null;
    });
    if (reading) return { ok: true, message: taxReader.saved };
  }
  // A policy is read into one for the person to confirm (spec step 151).
  if (kind === "insurance_policy") {
    const reading = await readPolicyDocument(user.id, result.id, {
      file: toRead,
    }).catch((error) => {
      log.error("Reading a policy failed", { error: String(error) });
      return null;
    });
    if (reading) {
      // Only what came from the file is "read": a reading can start from the person's payments to
      // the same insurer when Claude couldn't read it (debugger 11-05: "Jane read the policy in it"
      // over "No facts yet").
      const fromFile =
        result.read === "claude" || Object.values(reading.sources ?? {}).includes("document");
      return {
        ok: true,
        message: fromFile
          ? "Saved. Jane read the policy in it: confirm what Jane read on Insurance or in the chat, and it's added."
          : "Saved. Jane couldn't read the details in it, so it started from your payments: check it on Insurance or in the chat, and it's added.",
      };
    }
  }
  if (result.read === "you") {
    return { ok: true, message: "Saved. Fill in the key facts below so Jane can use them." };
  }
  return {
    ok: true,
    message: result.summaryRejected
      ? "Saved. Jane read the key facts below; add what it covers in your own words."
      : "Saved. Jane read the key facts below. Check them and fix anything that's off.",
  };
}

const FACT_FIELDS = [
  "provider",
  "policyType",
  "coverageSummary",
  "premiumCents",
  "premiumFrequency",
  "renewalDate",
  "warrantyEndsOn",
  "purchaseDate",
  "purchaseAmountCents",
] as const;

export async function saveFacts(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const raw: RawFacts = {};
  for (const field of FACT_FIELDS) {
    const value = formData.get(field);
    if (typeof value === "string") raw[field] = value;
  }
  const result = await saveDocumentFacts(user.id, String(formData.get("documentId") ?? ""), raw);
  return result.ok ? { ok: true, message: "Saved." } : { ok: false, message: result.error };
}

export async function deleteDocument(formData: FormData): Promise<void> {
  const user = await requireUser();
  await removeDocument(user.id, String(formData.get("documentId") ?? ""));
  revalidatePath("/documents");
}
