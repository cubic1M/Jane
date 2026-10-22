"use server";

import { readDraftReturn } from "@/lib/draft-return";
import { revalidatePath } from "next/cache";
import { MAX_DOCUMENT_BYTES, type DocumentContentType } from "@/config/documents";
import { track } from "@/lib/analytics";
import { isDocumentKind, type RawFacts } from "@/lib/documents/facts";
import { addDocument, removeDocument, saveDocumentFacts } from "@/lib/documents/store";
import { readTaxNotice } from "@/lib/tax-notices";
import { readPriorReturn } from "@/lib/prior-return";
import { readPolicyDocument } from "@/lib/insurance/readings";
import { hit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";

// Uploading, correcting and deleting documents on /documents (spec step 68). The upload
// and facts forms keep their message on screen and refresh the list themselves, so these
// don't revalidate /documents; deleting has no message, so it does.

export type FormState = { ok: boolean; message: string } | null;

export async function uploadDocument(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
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
      message: `That file is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB. Try a smaller scan or a photo.`,
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
  // A policy is read into one for the person to confirm (spec step 151). The upload's
  // stated type matched its bytes, or it wasn't saved.
  if (kind === "tax_notice") {
    const reading = await readTaxNotice(user.id, result.id, {
      file: { bytes, contentType: file.type as DocumentContentType },
    }).catch((error) => {
      console.error("Reading a tax notice failed", { error: String(error) });
      return null;
    });
    if (reading) {
      return {
        ok: true,
        message:
          "Saved. Check what Jane read on Letters from the IRS (Taxes) or in the chat, and confirm it.",
      };
    }
  }
  // Spec step 272: a draft return, read for the person to confirm, then checked before filing.
  if (kind === "draft_return") {
    const reading = await readDraftReturn(user.id, result.id, {
      file: { bytes, contentType: file.type as DocumentContentType },
    }).catch((error) => {
      console.error("Reading a draft return failed", { error: String(error) });
      return null;
    });
    if (reading) {
      return {
        ok: true,
        message:
          "Saved. Check what Jane read on Your draft return (Taxes) or in the chat, and confirm it: then she checks it before you file.",
      };
    }
  }
  if (kind === "tax_return") {
    const reading = await readPriorReturn(user.id, result.id, {
      file: { bytes, contentType: file.type as DocumentContentType },
    }).catch((error) => {
      console.error("Reading a tax return failed", { error: String(error) });
      return null;
    });
    if (reading) {
      return {
        ok: true,
        message:
          "Saved. Check what Jane read on Last year's return (Taxes) or in the chat, and confirm it.",
      };
    }
  }
  if (kind === "insurance_policy") {
    const reading = await readPolicyDocument(user.id, result.id, {
      file: { bytes, contentType: file.type as DocumentContentType },
    }).catch((error) => {
      console.error("Reading a policy failed", { error: String(error) });
      return null;
    });
    if (reading) {
      return {
        ok: true,
        message:
          "Saved. Jane read the policy in it: confirm what she read on Insurance or in the chat, and it's added.",
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
