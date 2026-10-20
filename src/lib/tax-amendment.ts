import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { filingPartnerFor } from "@/lib/filing";
import { loadReturnReviews, type AmendmentView } from "@/lib/prior-return/review";

// An amended return (spec step 172): Jane prepares it with the filing stand-in from what the
// review of a confirmed prior-year return found, the person reviews it and signs, and Jane
// tracks it. Nothing is amended without the person's review and signature: signAmendment
// checks both, here, whatever the page sent.

type Options = { client?: PrismaClient; now?: Date };

export class AmendmentError extends Error {}

export async function prepareAmendment(
  userId: string,
  year: number,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<AmendmentView> {
  const partner = await filingPartnerFor(userId, { client });
  if (!partner)
    throw new AmendmentError("Amending through Jane isn't available for your accounts yet.");
  const { reviews } = await loadReturnReviews(userId, { client, now });
  const review = reviews.find((r) => r.year === year);
  if (!review) throw new AmendmentError("Upload and confirm that year's return first.");
  if (review.amendment) throw new AmendmentError(`Your ${year} amended return is already started.`);
  if (!review.canAmend)
    throw new AmendmentError(`The time to amend ${year} ended on ${review.amendBy}.`);
  if (!review.worthAmending)
    throw new AmendmentError("There isn't enough missed to be worth amending.");
  const changes = review.findings.map((f) => ({
    key: f.key,
    title: f.title,
    savesCents: f.savesCents,
  }));
  const created = await partner.createAmendment({ taxYear: year, changes });
  const row = await scopedFor(userId, client).taxAmendments.create({
    data: {
      userId,
      year,
      partner: partner.name,
      partnerReturnId: created.partnerReturnId,
      status: "ready_for_review",
      changes: changes as unknown as Prisma.InputJsonArray,
      refundCents: created.refundCents,
    },
  });
  await logAudit(
    { type: "user", id: userId },
    "tax_amendment_started",
    { type: "tax_amendment", id: row.id },
    { year, via },
  );
  await track(userId, "tax_amendment_started", { via });
  return {
    id: row.id,
    year,
    status: "ready_for_review",
    changes,
    refundCents: row.refundCents,
    signerName: null,
  };
}

// The person's review and signature, then the submission. Both are required here.
export async function signAmendment(
  userId: string,
  input: { year: number; reviewed: boolean; signature: string },
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<AmendmentView> {
  const db = scopedFor(userId, client);
  const row = await db.taxAmendments.findFirst({ where: { year: input.year } });
  if (!row) throw new AmendmentError("There's no amended return to sign.");
  if (row.status !== "ready_for_review")
    throw new AmendmentError("This amended return has already been signed.");
  if (!input.reviewed)
    throw new AmendmentError("Tick that you've reviewed the amended return first.");
  const name = input.signature.trim().replace(/\s+/g, " ");
  if (name.length < 3 || !/\s/.test(name)) throw new AmendmentError("Sign with your full name.");
  const partner = await filingPartnerFor(userId, { client });
  if (!partner || partner.name !== row.partner)
    throw new AmendmentError("The filing partner isn't available.");
  await partner.submitReturn(row.partnerReturnId, { name, signedAt: now });
  await db.taxAmendments.updateMany({
    where: { id: row.id, status: "ready_for_review" },
    data: { status: "submitted", signerName: name, signedAt: now, submittedAt: now },
  });
  await logAudit(
    { type: "user", id: userId },
    "tax_amendment_signed",
    { type: "tax_amendment", id: row.id },
    { year: input.year },
  );
  await track(userId, "tax_amendment_signed", {});
  return {
    id: row.id,
    year: input.year,
    status: "submitted",
    changes: row.changes as AmendmentView["changes"],
    refundCents: row.refundCents,
    signerName: name,
  };
}
