import { FILING_SEASON, TAX_TAG_ORDER } from "@/config/tax";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { filingPartnerFor, type ReturnPackage, type ReturnPreview } from "@/lib/filing";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadTaxDocuments } from "@/lib/tax-documents";
import { loadTaxForms, loadTaxTags } from "@/lib/tax-organizer";
import { loadTaxProfile } from "@/lib/tax-profile";
import { isoDay as iso } from "@/lib/dates";

// Filing (spec step 126): Jane hands the year over to the filing partner, the person reviews
// it and signs, and Jane tracks it. Nothing is submitted without the person's review and
// signature: signReturn checks both, here, whatever the page sent.

type Options = { client?: PrismaClient; now?: Date };

export class FilingError extends Error {}

export type ReturnStatus = "ready_for_review" | "submitted" | "accepted" | "rejected";

export type ReturnView = {
  id: string;
  year: number;
  status: ReturnStatus;
  preview: ReturnPreview;
  package: ReturnPackage;
  signerName: string | null;
  signedAt: Date | null;
  submittedAt: Date | null;
  acceptedAt: Date | null;
};

// Filing season for a tax year: from late January to the October extension deadline.
export function inFilingSeason(year: number, today: string): boolean {
  return (
    today >= `${year + 1}-${FILING_SEASON.from}` && today <= `${year + 1}-${FILING_SEASON.until}`
  );
}

// The year a return is for: last year (filing happens the year after), until last year's
// season closes at the October extension deadline. After that the next return is this year's.
export function filingYear(today: string): number {
  const year = Number(today.slice(0, 4));
  return today > `${year}-${FILING_SEASON.until}` ? year : year - 1;
}

function toView(row: {
  id: string;
  year: number;
  status: string;
  preview: unknown;
  package: unknown;
  signerName: string | null;
  signedAt: Date | null;
  submittedAt: Date | null;
  acceptedAt: Date | null;
}): ReturnView {
  return {
    ...row,
    status: row.status as ReturnStatus,
    preview: row.preview as ReturnPreview,
    package: row.package as ReturnPackage,
  };
}

const RETURN_SELECT = {
  id: true,
  year: true,
  status: true,
  preview: true,
  package: true,
  signerName: true,
  signedAt: true,
  submittedAt: true,
  acceptedAt: true,
  partner: true,
  partnerReturnId: true,
} as const;

// What Jane hands over: what it knows, never account numbers or tokens.
export async function buildPackage(
  userId: string,
  year: number,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ pkg: ReturnPackage; preview: ReturnPreview; missing: string[] }> {
  const db = scopedFor(userId, client);
  const [profile, estimate, tags, forms, documents, collected] = await Promise.all([
    loadTaxProfile(userId, { client, now }),
    loadTaxEstimate(userId, { client, now, year }),
    loadTaxTags(userId, year, { client }),
    loadTaxForms(userId, year, { client, now }),
    db.documents.findMany({ select: { kind: true, fileName: true } }),
    loadTaxDocuments(userId, year, { client, now }),
  ]);
  const missing: string[] = [];
  if (profile.filingStatus.status !== "yours") missing.push("how you file");
  if (profile.dependants.status !== "yours") missing.push("your dependants");
  if (!estimate.withholdingKnown) missing.push("your pay stub figures");
  const input = estimate.input;
  const pkg: ReturnPackage = {
    taxYear: year,
    profile: {
      filingStatus: input.filingStatus,
      childrenUnder17: input.childrenUnder17,
      otherDependants: input.otherDependants,
      state: input.state,
      incomeKinds: profile.incomeKinds.value,
    },
    income: Object.fromEntries(Object.entries(input.income)),
    withholding: { federalCents: input.federalWithheldCents, stateCents: input.stateWithheldCents },
    estimatedPayments: {
      federalCents: input.federalEstimatedPaidCents,
      stateCents: input.stateEstimatedPaidCents,
    },
    deductions: {
      studentLoanInterestCents: input.studentLoanInterestCents,
      mortgageInterestCents: input.mortgageInterestCents,
    },
    tags: Object.fromEntries(TAX_TAG_ORDER.map((t) => [t, tags.totals[t].totalCents])),
    forms: forms.forms.map((f) => ({ form: f.form, from: f.from, received: f.received })),
    documents: documents.map((d) => ({ kind: d.kind, title: d.fileName })),
    // Spec step 166: the forms Jane collected, only those that check out or that the person
    // said are right. A flagged form is never handed over.
    collectedForms: collected.forms
      .filter((f) => f.document && f.usable)
      .map((f) => ({ form: f.form, from: f.from, boxes: { ...f.document!.boxes } })),
  };
  return {
    pkg,
    preview: {
      federalRefundCents: estimate.estimate.refundCents,
      stateRefundCents: estimate.estimate.state?.refundCents ?? null,
    },
    missing,
  };
}

export async function loadReturn(
  userId: string,
  year: number,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ReturnView | null> {
  const db = scopedFor(userId, client);
  const row = await db.taxReturns.findFirst({ where: { year }, select: RETURN_SELECT });
  if (!row) return null;
  // Check on a submitted return with the partner.
  if (row.status === "submitted" && row.submittedAt) {
    const partner = await filingPartnerFor(userId, { client });
    const status = partner
      ? await partner.status(row.partnerReturnId, row.submittedAt, now)
      : "submitted";
    if (status !== "submitted") {
      await db.taxReturns.updateMany({
        where: { id: row.id, status: "submitted" },
        data: { status, acceptedAt: status === "accepted" ? now : null },
      });
      await track(userId, "tax_return_status", { status });
      return toView({ ...row, status, acceptedAt: status === "accepted" ? now : null });
    }
  }
  return toView(row);
}

// Hands the year over to the partner: a return ready for the person to review.
export async function startReturn(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    via,
  }: Options & { via: "chat" | "page" | "autopilot" },
): Promise<ReturnView> {
  const year = filingYear(iso(now));
  const partner = await filingPartnerFor(userId, { client });
  if (!partner) {
    throw new FilingError(
      "Filing through Jane isn't available for your accounts yet. Your tax-time pack is ready for whoever does your taxes.",
    );
  }
  if (!inFilingSeason(year, iso(now)))
    throw new FilingError(`Filing for ${year} opens in late January ${year + 1}.`);
  const db = scopedFor(userId, client);
  const existing = await db.taxReturns.findFirst({ where: { year }, select: { id: true } });
  if (existing) throw new FilingError(`Your ${year} return is already started.`);
  const { pkg, preview, missing } = await buildPackage(userId, year, { client, now });
  if (missing.length > 0) {
    throw new FilingError(`First tell me ${missing.join(" and ")} on your tax profile.`);
  }
  const created = await partner.createReturn(pkg, preview);
  const row = await db.taxReturns.create({
    data: {
      userId,
      year,
      partner: partner.name,
      partnerReturnId: created.partnerReturnId,
      status: "ready_for_review",
      package: pkg as unknown as Prisma.InputJsonObject,
      preview: created.preview as unknown as Prisma.InputJsonObject,
    },
    select: RETURN_SELECT,
  });
  await logAudit(
    { type: "user", id: userId },
    "tax_return_started",
    { type: "tax_return", id: row.id },
    { year, via },
  );
  await track(userId, "tax_return_started", { via });
  return toView(row);
}

// The person's review and signature, then the submission. Both are required here.
export async function signReturn(
  userId: string,
  input: { year: number; reviewed: boolean; signature: string },
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ReturnView> {
  const db = scopedFor(userId, client);
  const row = await db.taxReturns.findFirst({ where: { year: input.year }, select: RETURN_SELECT });
  if (!row) throw new FilingError("There's no return to sign.");
  if (row.status !== "ready_for_review")
    throw new FilingError("This return has already been signed.");
  if (!input.reviewed) throw new FilingError("Tick that you've reviewed the return first.");
  const name = input.signature.trim().replace(/\s+/g, " ");
  if (name.length < 3 || !/\s/.test(name)) throw new FilingError("Sign with your full name.");
  const partner = await filingPartnerFor(userId, { client });
  if (!partner || partner.name !== row.partner)
    throw new FilingError("The filing partner isn't available.");
  await partner.submitReturn(row.partnerReturnId, { name, signedAt: now });
  await db.taxReturns.updateMany({
    where: { id: row.id, status: "ready_for_review" },
    data: { status: "submitted", signerName: name, signedAt: now, submittedAt: now },
  });
  await logAudit(
    { type: "user", id: userId },
    "tax_return_signed",
    { type: "tax_return", id: row.id },
    { year: input.year },
  );
  await track(userId, "tax_return_signed", {});
  return toView({ ...row, status: "submitted", signerName: name, signedAt: now, submittedAt: now });
}
