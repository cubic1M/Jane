import type { DocumentContentType } from "@/config/documents";
import { PRIOR_RETURN_FIELDS, type PriorReturnFieldKey } from "@/config/prior-return";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { anthropic, llmModel } from "@/lib/anthropic";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadTaxProfile } from "@/lib/tax-profile";
import {
  checkPriorReturn,
  type CheckedReading,
  type Fields,
  type Source,
} from "@/planning/prior-return";
import { readReturn } from "./read";

// A prior-year return read from an uploaded document (spec step 172), for the person to
// confirm. Like a policy read (step 151): Claude's reading, checked by rules, each field
// showing where it came from; without a key the fields are prefilled from the tax profile
// and the person types the rest. Nothing is used until they tap Confirm.

type Options = { client?: PrismaClient; now?: Date };

export class PriorReturnError extends Error {}

export type PriorReturnView = {
  id: string;
  documentId: string;
  fileName: string;
  fields: Fields;
  sources: Partial<Record<PriorReturnFieldKey, Source>>;
  notes: Partial<Record<PriorReturnFieldKey, string>>;
  status: "waiting" | "confirmed" | "dismissed";
  year: number | null;
};

const SELECT = {
  id: true,
  documentId: true,
  fields: true,
  sources: true,
  notes: true,
  status: true,
  document: { select: { fileName: true } },
} as const;

const obj = (v: unknown) =>
  (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, string>;

function toView(row: {
  id: string;
  documentId: string;
  fields: unknown;
  sources: unknown;
  notes: unknown;
  status: string;
  document: { fileName: string };
}): PriorReturnView {
  const fields = obj(row.fields) as Fields;
  return {
    id: row.id,
    documentId: row.documentId,
    fileName: row.document.fileName,
    fields,
    sources: obj(row.sources) as PriorReturnView["sources"],
    notes: obj(row.notes) as PriorReturnView["notes"],
    status: row.status as PriorReturnView["status"],
    year: fields.taxYear ? Number(fields.taxYear) : null,
  };
}

// Reads one uploaded return, once. bytes is the file just uploaded (Claude reads it when
// there's a key). The tax profile prefills how they filed.
export async function readPriorReturn(
  userId: string,
  documentId: string,
  {
    client = defaultClient,
    now = new Date(),
    file = null,
    claude = anthropic,
  }: Options & {
    file?: { bytes: Uint8Array; contentType: DocumentContentType } | null;
    claude?: typeof anthropic;
  } = {},
): Promise<PriorReturnView | null> {
  const db = scopedFor(userId, client);
  const existing = await db.priorReturns.findFirst({ where: { documentId }, select: SELECT });
  if (existing) return toView(existing);
  const document = await db.documents.findFirst({
    where: { id: documentId, kind: "tax_return" },
    select: { id: true },
  });
  if (!document) return null;

  const fields: Fields = {};
  const sources: Partial<Record<PriorReturnFieldKey, Source>> = {};
  if (file) {
    const read = await readReturn(file, { claude });
    if (read.kind === "claude") {
      for (const [k, v] of Object.entries(read.fields)) {
        fields[k as PriorReturnFieldKey] = v;
        sources[k as PriorReturnFieldKey] = "document";
      }
      // The file went to Claude: record that, and which model, never what it said.
      await logAudit(
        { type: "user", id: userId },
        "document_read",
        { type: "document", id: document.id },
        { model: llmModel(), tax_return: true },
      );
    } else if (read.kind === "failed") {
      console.warn("Reading a tax return failed", { reason: read.reason });
    }
  }
  const profile = await loadTaxProfile(userId, { client, now });
  if (!fields.filingStatus && profile.filingStatus.value) {
    fields.filingStatus = profile.filingStatus.value;
    sources.filingStatus = "profile";
  }
  const checked = checkPriorReturn(fields, sources, { today: now.toISOString().slice(0, 10) });
  try {
    const row = await db.priorReturns.create({
      data: {
        userId,
        documentId,
        fields: checked.fields,
        sources: checked.sources,
        notes: checked.notes,
        createdAt: now,
      },
      select: SELECT,
    });
    await track(userId, "prior_return_reading_ready", { read: file ? "tried" : "none" });
    return toView(row);
  } catch (error) {
    const again = await db.priorReturns.findFirst({ where: { documentId }, select: SELECT });
    if (again) return toView(again);
    throw error;
  }
}

export async function listPriorReturns(
  userId: string,
  { client = defaultClient, status }: Options & { status?: PriorReturnView["status"] } = {},
): Promise<PriorReturnView[]> {
  const rows = await scopedFor(userId, client).priorReturns.findMany({
    where: status ? { status } : {},
    select: SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toView);
}

export async function getPriorReturn(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<PriorReturnView | null> {
  const row = await scopedFor(userId, client).priorReturns.findFirst({
    where: { id },
    select: SELECT,
  });
  return row ? toView(row) : null;
}

// Confirm: the fields (as read, or as the person corrected them) are checked once more; a
// field that fails a rule stops the confirm. Only a confirmed return is ever used.
export async function confirmPriorReturn(
  userId: string,
  id: string,
  { client = defaultClient, now = new Date(), fields: typed }: Options & { fields?: Fields } = {},
): Promise<PriorReturnView> {
  const db = scopedFor(userId, client);
  const reading = await getPriorReturn(userId, id, { client });
  if (!reading || reading.status !== "waiting") {
    throw new PriorReturnError("That one's already been answered.");
  }
  const given = typed ?? reading.fields;
  const sources = { ...reading.sources };
  if (typed) {
    for (const f of PRIOR_RETURN_FIELDS) {
      if (typed[f.key] !== reading.fields[f.key]) sources[f.key] = "you";
    }
  }
  const checked: CheckedReading = checkPriorReturn(given, sources, {
    today: now.toISOString().slice(0, 10),
  });
  const failed = Object.values(checked.notes).filter((n) => n && !n.startsWith("The deduction"));
  if (failed.length > 0 || !checked.fields.taxYear) {
    throw new PriorReturnError(failed[0] ?? "Give the tax year the return is for.");
  }
  // One confirmed return per tax year: a newer one replaces.
  const year = Number(checked.fields.taxYear);
  const others = (await listPriorReturns(userId, { client, status: "confirmed" })).filter(
    (r) => r.year === year && r.id !== id,
  );
  for (const o of others)
    await db.priorReturns.updateMany({ where: { id: o.id }, data: { status: "dismissed" } });
  await db.priorReturns.updateMany({
    where: { id, status: "waiting" },
    data: {
      status: "confirmed",
      fields: checked.fields,
      sources: checked.sources,
      notes: checked.notes,
      confirmedAt: now,
    },
  });
  await logAudit(
    { type: "user", id: userId },
    "tax_return_read_confirmed",
    { type: "document", id: reading.documentId },
    { year },
  );
  await track(userId, "prior_return_confirmed", {});
  return (await getPriorReturn(userId, id, { client }))!;
}

export async function dismissPriorReturn(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const res = await scopedFor(userId, client).priorReturns.updateMany({
    where: { id, status: "waiting" },
    data: { status: "dismissed" },
  });
  if (res.count === 0) throw new PriorReturnError("That one's already been answered.");
  await track(userId, "prior_return_dismissed", {});
}
