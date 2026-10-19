import {
  TAXABLE_INVESTMENT_SUBTYPES,
  TAX_DOCUMENTS,
  TAX_FORMS,
  type TaxFormKey,
} from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addDeadline } from "@/lib/deadlines";
import { documentPartnerFor } from "@/lib/tax-docs";
import { loadTaxForms, markTaxForm } from "@/lib/tax-organizer";
import {
  checkDocument,
  usable,
  type DocumentBoxes,
  type DocumentCheck,
} from "@/planning/tax-document-check";
import type { ExpectedForm } from "@/planning/tax-documents";
import { DIVIDENDS } from "@/planning/tax-income";

// Tax forms that collect themselves (spec step 166). From late January Jane asks the
// document partner (the demo stand-in for now) once a day for each expected form past its
// usual date, stores what comes back, and checks every form against the accounts each time
// it's shown. One that disagrees is flagged and never used (not ticked off, not handed to
// the filing partner) until the person says it's right; one still missing a week after its
// date gets a nudge.

type Options = { client?: PrismaClient; now?: Date };

export class TaxDocumentError extends Error {}

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, days: number) =>
  iso(new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS));

export type Decision = "right" | "ask";

export type CollectedForm = ExpectedForm & {
  received: boolean;
  document: {
    boxes: DocumentBoxes;
    partner: string;
    fetchedAt: string;
    decision: Decision | null;
  } | null;
  check: DocumentCheck | null;
  // Its figures may be used: collected, and matching, unchecked or said right.
  usable: boolean;
};

export type TaxDocumentsView = {
  year: number;
  // A partner collects this person's forms.
  collecting: boolean;
  forms: CollectedForm[];
  flagged: CollectedForm[];
  // Past their date by TAX_DOCUMENTS.chaseDays, not collected, not ticked off.
  missing: CollectedForm[];
};

// The window Jane collects in: TAX_DOCUMENTS from/until of the year after.
export const inDocumentSeason = (today: string) =>
  today.slice(5) >= TAX_DOCUMENTS.from && today.slice(5) <= TAX_DOCUMENTS.until;

// Dividends seen in each taxable investment account, for its consolidated 1099.
async function dividendsByAccount(userId: string, year: number, client: PrismaClient) {
  const db = scopedFor(userId, client);
  const [accounts, cash] = await Promise.all([
    db.accounts.findMany({
      where: { type: "investment" },
      select: { id: true, name: true, subtype: true },
    }),
    db.investmentTransactions.findMany({
      where: {
        type: "cash",
        amountCents: { lt: 0 },
        date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
      select: { accountId: true, amountCents: true, subtype: true },
    }),
  ]);
  const out = new Map<string, number>();
  for (const a of accounts) {
    if (!TAXABLE_INVESTMENT_SUBTYPES.includes(a.subtype ?? "")) continue;
    const cents = cash
      .filter((c) => c.accountId === a.id && DIVIDENDS.has(c.subtype))
      .reduce((s, c) => s - c.amountCents, 0);
    out.set(a.name, (out.get(a.name) ?? 0) + cents);
  }
  return out;
}

export async function loadTaxDocuments(
  userId: string,
  year: number,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<TaxDocumentsView> {
  const db = scopedFor(userId, client);
  const [expected, stored, partner, dividends] = await Promise.all([
    loadTaxForms(userId, year, { client, now }),
    db.taxDocuments.findMany({
      where: { year },
      select: { key: true, boxes: true, partner: true, fetchedAt: true, decision: true },
    }),
    documentPartnerFor(userId, { client }),
    dividendsByAccount(userId, year, client),
  ]);
  const byKey = new Map(stored.map((d) => [d.key, d]));
  const today = iso(now);
  const forms: CollectedForm[] = expected.forms.map((f) => {
    const row = byKey.get(f.key);
    if (!row) return { ...f, document: null, check: null, usable: false };
    const boxes = (row.boxes ?? {}) as DocumentBoxes;
    const seen = f.formKey === "brokerage" ? (dividends.get(f.from) ?? null) : f.amountCents;
    const check = checkDocument(f.formKey, boxes, seen);
    const decision = row.decision === "right" || row.decision === "ask" ? row.decision : null;
    return {
      ...f,
      document: { boxes, partner: row.partner, fetchedAt: iso(row.fetchedAt), decision },
      check,
      usable: usable(check, decision === "right"),
    };
  });
  return {
    year,
    collecting: partner !== null,
    forms,
    flagged: forms.filter((f) => f.check?.status === "differs" && f.document?.decision === null),
    missing: forms.filter(
      (f) =>
        !f.document &&
        !f.received &&
        !f.mayNotSend &&
        addDays(f.by, TAX_DOCUMENTS.chaseDays) <= today,
    ),
  };
}

// Once a day in the season: asks the partner for each expected form past its date and not
// collected yet, and stores what comes back. At the levels that let Jane act (`tick`), the
// forms that check out are ticked off. Never uses a flagged form.
export async function collectTaxDocuments(
  userId: string,
  { client = defaultClient, now = new Date(), tick }: Options & { tick: boolean },
): Promise<{ collected: number; ticked: number }> {
  const today = iso(now);
  const none = { collected: 0, ticked: 0 };
  if (!inDocumentSeason(today)) return none;
  const partner = await documentPartnerFor(userId, { client });
  if (!partner) return none;
  const db = scopedFor(userId, client);
  const profile = await db.taxProfiles.findFirst({ select: { documentsCheckedOn: true } });
  if (profile?.documentsCheckedOn && iso(profile.documentsCheckedOn) >= today) return none;
  const year = now.getUTCFullYear() - 1;
  const before = await loadTaxDocuments(userId, year, { client, now });
  const wanted = before.forms.filter((f) => !f.document && f.by <= today);
  const fetched = wanted.length
    ? await partner.fetchForms(userId, year, wanted, { client, today })
    : [];
  for (const form of fetched) {
    const expected = wanted.find((f) => f.key === form.key);
    if (!expected) continue;
    await db.taxDocuments.upsert({
      where: { userId_year_key: { userId, year, key: form.key } },
      create: {
        userId,
        year,
        key: form.key,
        formKey: expected.formKey,
        payer: expected.from,
        partner: partner.name,
        boxes: form.boxes,
        fetchedAt: now,
      },
      update: {},
    });
    await logAudit(
      { type: "system", id: null },
      "tax_document_collected",
      { type: "user", id: userId },
      { year, form: expected.formKey, partner: partner.name },
    );
  }
  await db.taxProfiles.upsert({
    where: { userId },
    create: { userId, documentsCheckedOn: new Date(`${today}T00:00:00Z`) },
    update: { documentsCheckedOn: new Date(`${today}T00:00:00Z`) },
  });
  if (fetched.length > 0) {
    await track(userId, "tax_documents_collected", {
      count: fetched.length,
      partner: partner.name,
    });
  }
  let ticked = 0;
  if (tick) {
    const after = await loadTaxDocuments(userId, year, { client, now });
    for (const f of after.forms) {
      if (f.document && f.usable && !f.received) {
        await markTaxForm(userId, year, f.key, true, { client, now, via: "autopilot" });
        ticked += 1;
      }
    }
  }
  return { collected: fetched.length, ticked };
}

// "Tick them off" at the levels that ask first: every collected form that checks out.
export async function tickCollected(
  userId: string,
  year: number,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<number> {
  const view = await loadTaxDocuments(userId, year, { client, now });
  let ticked = 0;
  for (const f of view.forms) {
    if (f.document && f.usable && !f.received) {
      await markTaxForm(userId, year, f.key, true, { client, now, via });
      ticked += 1;
    }
  }
  return ticked;
}

// On a flagged form: "It's right, use it" (ticked off, used from now on) or "I'll ask
// them" (a reminder on their deadlines to ask the payer for a corrected form).
export async function decideDocument(
  userId: string,
  year: number,
  key: string,
  decision: Decision,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<CollectedForm> {
  const view = await loadTaxDocuments(userId, year, { client, now });
  const form = view.forms.find((f) => f.key === key);
  if (!form?.document) throw new TaxDocumentError("That form isn't collected anymore.");
  const db = scopedFor(userId, client);
  await db.taxDocuments.updateMany({
    where: { year, key },
    data: { decision, decidedAt: now },
  });
  if (decision === "right") {
    await markTaxForm(userId, year, key, true, { client, now, via });
  } else {
    await addDeadline(
      userId,
      {
        title: `Ask ${form.from} for a corrected ${TAX_FORMS[form.formKey as TaxFormKey].form}`,
        dueOn: addDays(iso(now), TAX_DOCUMENTS.remindDays),
        kind: "other",
        note: `Their form doesn't match your accounts. Jane isn't using it until it's sorted.`,
      },
      { client, now },
    );
  }
  await logAudit(
    { type: "user", id: userId },
    "tax_document_decided",
    { type: "user", id: userId },
    { year, form: form.formKey, decision, via },
  );
  await track(userId, "tax_document_decided", { decision, via });
  return form;
}

// "Remind me" on a form still missing: a reminder to ask the payer.
export async function chaseMissing(
  userId: string,
  year: number,
  key: string,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<ExpectedForm> {
  const view = await loadTaxDocuments(userId, year, { client, now });
  const form = view.missing.find((f) => f.key === key);
  if (!form) throw new TaxDocumentError("That form isn't missing anymore.");
  await addDeadline(
    userId,
    {
      title: `Ask ${form.from} for your ${form.form}`,
      dueOn: addDays(iso(now), TAX_DOCUMENTS.remindDays),
      kind: "other",
      note: `It was due by ${form.by}. Most payers can send it again or put it online.`,
    },
    { client, now },
  );
  await track(userId, "tax_document_chased", { form: form.formKey, via });
  return form;
}
