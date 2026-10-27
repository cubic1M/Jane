import type { DocumentContentType } from "@/config/documents";
import type { PolicyKind } from "@/config/insurance";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { anthropic, llmModel } from "@/lib/anthropic";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { documentTitle } from "@/lib/documents/dates";
import { checkGuardrails } from "@/lib/guardrails";
import {
  DOCUMENT_KIND,
  PolicyError,
  checkPolicy,
  listPolicies,
  policyFormValues,
  yearlyPremium,
  type Policy,
  type PolicyInput,
} from "./policies";
import { readPolicyDetails } from "./read-policy";
import {
  checkReading,
  flatten,
  mergeLayers,
  toInput,
  type Fields,
  type Layer,
  type ReadingSource,
} from "./reading-rules";
import { centsToInput } from "@/lib/money";

// Policies read from documents (spec step 151). A declarations page or renewal notice
// uploaded on Documents is read into a policy for the person to confirm: the insurer,
// price and renewal date step 68 read, plus the deductible and cover limits Claude reads
// here, checked by the reading rules. Without a key, the fields are prefilled from the
// person's insurance payments. Every field keeps where it came from, and nothing is saved
// to their insurance until they tap Confirm. A renewal notice for a policy already on file
// updates that policy.

type Options = { client?: PrismaClient; now?: Date };

export class ReadingError extends Error {}

export type Reading = {
  id: string;
  documentId: string;
  // What the document is called: "GEICO car insurance", or its file name.
  title: string;
  // The policy it updates, or null for a new one.
  policyId: string | null;
  input: PolicyInput;
  sources: Record<string, ReadingSource>;
  notes: Record<string, string>;
  status: "waiting" | "confirmed" | "dismissed";
  createdAt: Date;
};

const SELECT = {
  id: true,
  documentId: true,
  policyId: true,
  fields: true,
  sources: true,
  notes: true,
  status: true,
  createdAt: true,
  document: { select: { kind: true, provider: true, policyType: true, fileName: true } },
} as const;

const record = (value: unknown) =>
  (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<
    string,
    string
  >;

function toReading(row: Prisma.PolicyReadingGetPayload<{ select: typeof SELECT }>): Reading {
  return {
    id: row.id,
    documentId: row.documentId,
    title: documentTitle(row.document),
    policyId: row.policyId,
    input: toInput(record(row.fields)),
    sources: record(row.sources) as Record<string, ReadingSource>,
    notes: record(row.notes),
    status: row.status as Reading["status"],
    createdAt: row.createdAt,
  };
}

const words = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

// Pure: whether two insurer names are the same company ("GEICO" and "GEICO General").
export function sameInsurer(a: string, b: string): boolean {
  const [x, y] = [words(a), words(b)];
  return x.length > 0 && y.length > 0 && x[0] === y[0];
}

const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : "");

// The policy a document is about, when one is on file: the same insurer, and the same kind
// when the document says one. Payments-found policies count (the document confirms them);
// benefits through work don't.
function policyOnFile(policies: Policy[], carrier: string | null, kind: PolicyKind | null) {
  const same = policies.filter(
    (p) => p.source !== "employer" && carrier !== null && sameInsurer(p.carrier, carrier),
  );
  return same.find((p) => kind === null || p.kind === kind) ?? null;
}

// Reads one uploaded policy document into a reading, once. bytes is the file just uploaded
// (Claude reads its cover limits when there's a key); without it only what's on record is
// used. Null when it isn't a policy document or nothing points to an insurer.
export async function readPolicyDocument(
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
): Promise<Reading | null> {
  const db = scopedFor(userId, client);
  const existing = await db.policyReadings.findFirst({ where: { documentId }, select: SELECT });
  if (existing) return toReading(existing);
  const document = await db.documents.findFirst({
    where: { id: documentId, kind: "insurance_policy" },
    select: {
      id: true,
      provider: true,
      policyType: true,
      coverageSummary: true,
      premiumCents: true,
      premiumFrequency: true,
      renewalDate: true,
      extractionSource: true,
    },
  });
  if (!document) return null;
  const policies = await listPolicies(userId, { client });
  const fromPayments = policies.filter((p) => p.source === "payments" && p.documentId === null);
  const kind = DOCUMENT_KIND[document.policyType ?? ""] ?? null;

  // The facts step 68 read (or the person typed) about this document.
  const facts: Fields = flatten({
    kind: kind ?? "",
    carrier: document.provider ?? "",
    premium: centsToInput(document.premiumCents),
    premiumFrequency: document.premiumFrequency ?? "",
    renewalDate: day(document.renewalDate),
    covers:
      document.coverageSummary &&
      checkGuardrails(document.coverageSummary, [document.premiumCents ?? 0]).ok
        ? document.coverageSummary
        : "",
  });
  const factsSource: ReadingSource = document.extractionSource === "claude" ? "document" : "you";

  // Payments to the same insurer; with no insurer on the document, the one insurer the
  // person pays that has no document yet.
  const paid = document.provider
    ? fromPayments.find((p) => sameInsurer(p.carrier, document.provider!))
    : fromPayments.length === 1
      ? fromPayments[0]
      : undefined;
  const carrier = document.provider ?? paid?.carrier ?? null;
  const onFile = policyOnFile(policies, carrier, kind ?? paid?.kind ?? null) ?? paid ?? null;
  if (!carrier) return null;

  const layers: Layer[] = [];
  const readKind = kind ?? onFile?.kind ?? null;
  if (file && readKind) {
    const details = await readPolicyDetails(file, readKind, { claude });
    if (details.kind === "claude") {
      layers.push({ source: "document", fields: details.fields });
      // The file went to Claude: record that, and which model, never what it said.
      await logAudit(
        { type: "user", id: userId },
        "document_read",
        { type: "document", id: document.id },
        { model: llmModel(), cover_limits: true },
      );
    } else if (details.kind === "failed") {
      console.warn("Reading a policy's cover limits failed", { reason: details.reason });
    }
  }
  layers.push({ source: factsSource, fields: facts });
  if (paid) {
    layers.push({
      source: "payments",
      fields: flatten({
        kind: paid.kind,
        carrier: paid.carrier,
        premium: centsToInput(paid.premiumCents),
        premiumFrequency: paid.premiumFrequency ?? "",
      }),
    });
  }
  if (onFile && onFile.source !== "payments") {
    layers.push({ source: "policy", fields: flatten(policyFormValues(onFile)) });
  }
  const checked = checkReading(mergeLayers(layers), {
    asOf: day(now),
    paidYearlyCents: paid ? yearlyPremium(paid) : null,
  });
  try {
    const row = await db.policyReadings.create({
      data: {
        userId,
        documentId: document.id,
        policyId: onFile?.id ?? null,
        fields: checked.fields,
        sources: checked.sources,
        notes: checked.notes,
        createdAt: now,
      },
      select: SELECT,
    });
    await track(userId, "policy_reading_ready", {
      read: layers[0]?.source ?? "none",
      update: onFile !== null,
    });
    return toReading(row);
  } catch (error) {
    // Read twice at once: the other one's kept.
    const again = await db.policyReadings.findFirst({ where: { documentId }, select: SELECT });
    if (again) return toReading(again);
    throw error;
  }
}

// Every policy document without a reading yet (uploaded before step 151, or with its
// facts typed later) is read from what's on record. A document already behind a policy
// on file isn't read again.
export async function readingsFromDocuments(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  // One query: policy documents with no reading and no policy made from them.
  const documents = await scopedFor(userId, client).documents.findMany({
    where: {
      kind: "insurance_policy",
      policyReading: { is: null },
      insurancePolicies: { none: {} },
    },
    select: { id: true },
    orderBy: { uploadedAt: "asc" },
  });
  let read = 0;
  for (const d of documents) {
    if (await readPolicyDocument(userId, d.id, { client, now })) read += 1;
  }
  return read;
}

export async function listReadings(
  userId: string,
  { client = defaultClient, status }: Options & { status?: Reading["status"] } = {},
): Promise<Reading[]> {
  const rows = await scopedFor(userId, client).policyReadings.findMany({
    where: status ? { status } : {},
    select: SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toReading);
}

export async function getReading(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<Reading | null> {
  const row = await scopedFor(userId, client).policyReadings.findFirst({
    where: { id },
    select: SELECT,
  });
  return row ? toReading(row) : null;
}

// Confirm: the reading (as read, or as the person corrected it on the page) becomes a policy
// on their insurance, or updates the one on file. Returns the policy's id.
export async function confirmReading(
  userId: string,
  id: string,
  { client = defaultClient, now = new Date(), input }: Options & { input?: PolicyInput } = {},
): Promise<string> {
  const db = scopedFor(userId, client);
  const reading = await getReading(userId, id, { client });
  if (!reading || reading.status !== "waiting") {
    throw new ReadingError("That one's already been answered.");
  }
  let checked;
  try {
    checked = checkPolicy(input ?? reading.input);
  } catch (error) {
    if (error instanceof PolicyError) throw new ReadingError(error.message);
    throw error;
  }
  // The policy it updates, if it's still on file; else one already made from this document.
  const target = await db.insurancePolicies.findFirst({
    where: {
      status: { in: ["active", "found", "pending"] },
      OR: [{ id: reading.policyId ?? "" }, { documentId: reading.documentId }],
    },
    select: { id: true },
  });
  let policyId: string;
  if (target) {
    // A renewal notice moves the policy onto the newest document.
    await db.insurancePolicies.updateMany({
      where: { documentId: reading.documentId, id: { not: target.id } },
      data: { documentId: null },
    });
    await db.insurancePolicies.updateMany({
      where: { id: target.id },
      data: { ...checked, status: "active", documentId: reading.documentId },
    });
    policyId = target.id;
  } else {
    const row = await db.insurancePolicies.create({
      data: {
        ...checked,
        userId,
        source: "document",
        status: "active",
        documentId: reading.documentId,
      },
      select: { id: true },
    });
    policyId = row.id;
  }
  const { count } = await db.policyReadings.updateMany({
    where: { id, status: "waiting" },
    data: { status: "confirmed", policyId, answeredAt: now },
  });
  if (count === 0) throw new ReadingError("That one's already been answered.");
  await logAudit(
    { type: "user", id: userId },
    "insurance_policy_saved",
    { type: "insurance_policy", id: policyId },
    { kind: checked.kind, from: "document" },
  );
  await track(userId, "policy_reading_confirmed", {
    update: target !== null,
    corrected: input !== undefined,
  });
  return policyId;
}

// Not a policy (or not this one): nothing is saved, and the document isn't read again.
export async function dismissReading(
  userId: string,
  id: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const { count } = await scopedFor(userId, client).policyReadings.updateMany({
    where: { id, status: "waiting" },
    data: { status: "dismissed", answeredAt: now },
  });
  if (count === 0) throw new ReadingError("That one's already been answered.");
  await track(userId, "policy_reading_dismissed");
}
