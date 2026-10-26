import type { DocumentContentType } from "@/config/documents";
import { DRAFT_FIELDS, type DraftFieldKey } from "@/config/draft-return";
import { TUITION_PAYEE } from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { anthropic, llmModel } from "@/lib/anthropic";
import { logAudit } from "@/lib/audit";
import { encryptBytes } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadTaxDocuments } from "@/lib/tax-documents";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadTaxTags } from "@/lib/tax-organizer";
import {
  checkDraft,
  demoDraft,
  reviewDraft,
  type DraftFields,
  type DraftFinding,
  type DraftSource,
  type Known,
} from "@/planning/draft-return";
import { readDraft } from "./read";
import { isoDay as iso } from "@/lib/dates";

// The return, checked before you file (spec step 272). A draft (a PDF from tax software or an
// accountant) uploaded to Documents as "Draft tax return" is read (by Claude with a key; for
// demo-bank people without one, the stand-in's demo draft), shown for the person to confirm or
// correct, and only then checked line by line against what Jane knows for the year. Each finding
// is a card with its dollars. Jane never files: fixing the draft and filing are the person's.

type Options = { client?: PrismaClient; now?: Date };

export class DraftReturnError extends Error {}

export type DraftReturnView = {
  id: string;
  documentId: string;
  fileName: string;
  fields: DraftFields;
  sources: Partial<Record<DraftFieldKey, DraftSource>>;
  notes: Partial<Record<DraftFieldKey, string>>;
  status: "waiting" | "confirmed" | "dismissed";
  year: number | null;
  findings: DraftFinding[];
};

const SELECT = {
  id: true,
  documentId: true,
  fields: true,
  sources: true,
  notes: true,
  status: true,
  findings: true,
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
  findings: unknown;
  document: { fileName: string };
}): DraftReturnView {
  const fields = obj(row.fields) as DraftFields;
  return {
    id: row.id,
    documentId: row.documentId,
    fileName: row.document.fileName,
    fields,
    sources: obj(row.sources) as DraftReturnView["sources"],
    notes: obj(row.notes) as DraftReturnView["notes"],
    status: row.status as DraftReturnView["status"],
    year: fields.taxYear ? Number(fields.taxYear) : null,
    findings: Array.isArray(row.findings) ? (row.findings as DraftFinding[]) : [],
  };
}

// What Jane knows for a tax year: its estimate, the forms it collected (only usable ones), and
// the tags for tuition and childcare.
export async function knownFor(
  userId: string,
  year: number,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Known> {
  const [estimate, docs, tags] = await Promise.all([
    loadTaxEstimate(userId, { client, now, year }),
    loadTaxDocuments(userId, year, { client, now }),
    loadTaxTags(userId, year, { client }),
  ]);
  const usable = docs.forms.filter((f) => f.document && f.usable);
  const of = (key: string) => usable.filter((f) => f.formKey === key);
  const box = (forms: typeof usable, name: string) =>
    forms.reduce((s, f) => s + (f.document!.boxes[name] ?? 0), 0);
  const names = (forms: typeof usable) => forms.map((f) => `${f.form} from ${f.from}`).join(", ");
  const w2 = of("w2");
  const ints = of("int");
  const brokerage = of("brokerage");
  const nec = of("nec");
  const student = of("student");
  const withholding = usable.filter((f) => f.document!.boxes.federalWithheld !== undefined);
  const input = estimate.input;
  const from: Known["from"] = {};
  if (w2.length) from.wages = `Your ${names(w2)}`;
  if (withholding.length) from.federalWithheld = `Your ${names(withholding)}`;
  if (ints.length) from.interest = `Your ${names(ints)}`;
  if (brokerage.length) from.dividends = from.capitalGains = `Your ${names(brokerage)}`;
  if (nec.length) from.businessIncome = `Your ${names(nec)}`;
  return {
    year,
    input,
    w2WagesCents: w2.length ? box(w2, "wages") : null,
    withheldCents: withholding.length ? box(withholding, "federalWithheld") : null,
    interestCents: ints.length ? box(ints, "interest") : input.income.interestCents,
    dividendsCents: brokerage.length ? box(brokerage, "dividends") : input.income.dividendsCents,
    gainsCents: brokerage.length
      ? box(brokerage, "shortTermGain") + box(brokerage, "longTermGain")
      : input.income.shortTermGainsCents + input.income.longTermGainsCents,
    businessCents: input.income.selfEmploymentCents,
    estimatedPaidCents: input.federalEstimatedPaidCents,
    studentLoanInterestCents: student.length
      ? box(student, "interest")
      : input.studentLoanInterestCents,
    tuitionCents: tags.tagged
      .filter((t) => t.tag === "education" && TUITION_PAYEE.test(t.payee))
      .reduce((s, t) => s + t.amountCents, 0),
    careCents: tags.totals.childcare.totalCents,
    children: Array.from({ length: input.childrenUnder17 }, () => ({
      ageAtYearEnd: 5,
      hasSsn: true,
      monthsLivedWithYou: 12,
    })),
    from,
  };
}

// Reads one uploaded draft, once.
export async function readDraftReturn(
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
): Promise<DraftReturnView | null> {
  const db = scopedFor(userId, client);
  const existing = await db.draftReturns.findFirst({ where: { documentId }, select: SELECT });
  if (existing) return toView(existing);
  const document = await db.documents.findFirst({
    where: { id: documentId, kind: "draft_return" },
    select: { id: true },
  });
  if (!document) return null;

  let fields: DraftFields = {};
  const sources: Partial<Record<DraftFieldKey, DraftSource>> = {};
  const read = file ? await readDraft(file, { claude }) : ({ kind: "unavailable" } as const);
  if (read.kind === "claude") {
    fields = read.fields;
    for (const k of Object.keys(fields)) sources[k as DraftFieldKey] = "document";
    await logAudit(
      { type: "user", id: userId },
      "document_read",
      { type: "document", id: document.id },
      { model: llmModel(), draft_return: true },
    );
  } else if (read.kind === "unavailable" && (await adviceMode(userId, { client }))) {
    // The stand-in: a demo-bank person's demo draft, from their own figures, with mistakes in it.
    const year = now.getUTCFullYear() - 1;
    fields = demoDraft(await knownFor(userId, year, { client, now })).fields;
    for (const k of Object.keys(fields)) sources[k as DraftFieldKey] = "demo";
  } else if (read.kind === "failed") {
    console.warn("Reading a draft return failed", { reason: read.reason });
  }
  const checked = checkDraft(fields, sources, { today: iso(now) });
  try {
    const row = await db.draftReturns.create({
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
    await track(userId, "draft_return_reading_ready", { read: read.kind });
    return toView(row);
  } catch (error) {
    const again = await db.draftReturns.findFirst({ where: { documentId }, select: SELECT });
    if (again) return toView(again);
    throw error;
  }
}

// Sample data only (demo advice, step 98): a sample draft to check without a file to upload, so
// a Try Jane person can see the check. The stand-in reader fills it from their own figures, with
// its planted mistakes; nothing goes to Claude. One at a time: a waiting sample is reused.
export const SAMPLE_DRAFT_NAME = "Sample draft return.pdf";
const SAMPLE_DRAFT_BYTES = new TextEncoder().encode("%PDF-1.4\n% Sample draft return\n%%EOF\n");

export async function addSampleDraft(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<DraftReturnView> {
  if (!(await adviceMode(userId, { client }))) {
    throw new DraftReturnError("The sample draft is only for sample data.");
  }
  const db = scopedFor(userId, client);
  const waiting = await db.draftReturns.findFirst({
    where: { status: "waiting", document: { fileName: SAMPLE_DRAFT_NAME } },
    select: SELECT,
  });
  if (waiting) return toView(waiting);
  const document = await db.documents.create({
    data: {
      userId,
      kind: "draft_return",
      fileName: SAMPLE_DRAFT_NAME,
      contentType: "application/pdf",
      sizeBytes: SAMPLE_DRAFT_BYTES.length,
      encryptedBytes: encryptBytes(SAMPLE_DRAFT_BYTES),
      uploadedAt: now,
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "document_uploaded",
    { type: "document", id: document.id },
    { kind: "draft_return", sample: true },
  );
  return (await readDraftReturn(userId, document.id, { client, now }))!;
}

export async function listDraftReturns(
  userId: string,
  { client = defaultClient, status }: Options & { status?: DraftReturnView["status"] } = {},
): Promise<DraftReturnView[]> {
  const rows = await scopedFor(userId, client).draftReturns.findMany({
    where: status ? { status } : {},
    select: SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toView);
}

export async function getDraftReturn(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<DraftReturnView | null> {
  const row = await scopedFor(userId, client).draftReturns.findFirst({
    where: { id },
    select: SELECT,
  });
  return row ? toView(row) : null;
}

// Confirm: the fields (as read, or as the person corrected them) are checked once more, then the
// draft is checked against what Jane knows and the findings kept. Only a confirmed draft is ever
// checked. Nothing is filed.
export async function confirmDraftReturn(
  userId: string,
  id: string,
  {
    client = defaultClient,
    now = new Date(),
    fields: typed,
  }: Options & { fields?: DraftFields } = {},
): Promise<DraftReturnView> {
  const db = scopedFor(userId, client);
  const reading = await getDraftReturn(userId, id, { client });
  if (!reading || reading.status !== "waiting") {
    throw new DraftReturnError("That one's already been answered.");
  }
  const given = typed ?? reading.fields;
  const sources = { ...reading.sources };
  if (typed) {
    for (const f of DRAFT_FIELDS) {
      if (typed[f.key] !== reading.fields[f.key]) sources[f.key] = "you";
    }
  }
  const checked = checkDraft(given, sources, { today: iso(now) });
  const failed = Object.values(checked.notes).filter(Boolean);
  if (failed.length > 0 || !checked.fields.taxYear) {
    throw new DraftReturnError(failed[0] ?? "Give the tax year the draft is for.");
  }
  const year = Number(checked.fields.taxYear);
  const findings = reviewDraft(checked.fields, await knownFor(userId, year, { client, now }));
  await db.draftReturns.updateMany({
    where: { id, status: "waiting" },
    data: {
      status: "confirmed",
      fields: checked.fields,
      sources: checked.sources,
      notes: checked.notes,
      findings,
      confirmedAt: now,
    },
  });
  await logAudit(
    { type: "user", id: userId },
    "tax_return_read_confirmed",
    { type: "document", id: reading.documentId },
    { year, draft: true },
  );
  await track(userId, "draft_return_checked", { findings: findings.length });
  return (await getDraftReturn(userId, id, { client }))!;
}

export async function dismissDraftReturn(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const res = await scopedFor(userId, client).draftReturns.updateMany({
    where: { id, status: "waiting" },
    data: { status: "dismissed" },
  });
  if (res.count === 0) throw new DraftReturnError("That one's already been answered.");
  await track(userId, "draft_return_dismissed", {});
}

// The latest checked draft's findings, for the detectors and the chat.
export async function latestDraftCheck(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<{ id: string; year: number; findings: DraftFinding[] } | null> {
  const confirmed = await listDraftReturns(userId, { client, status: "confirmed" });
  const last = confirmed.at(-1);
  return last && last.year !== null
    ? { id: last.id, year: last.year, findings: last.findings }
    : null;
}
