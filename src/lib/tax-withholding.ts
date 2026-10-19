import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadTaxEstimate, type TaxEstimateView } from "@/lib/tax-estimate";
import { withholdingCheck, type W4Step, type WithholdingCheck } from "@/planning/withholding";

// The withholding checkup (spec step 121), from the same estimate as /taxes. The W-4
// suggestion is demo advice: only in demo advice mode; everyone else sees the comparison and
// the IRS's own estimator. Jane never sends a W-4: the person does, and tells her.

type Options = { client?: PrismaClient; now?: Date };

export class WithholdingError extends Error {}

export type WithholdingView = {
  estimate: TaxEstimateView;
  check: WithholdingCheck;
  // Demo advice mode: the W-4 suggestion may be shown.
  advice: boolean;
};

export function checkFrom(view: TaxEstimateView): WithholdingCheck {
  return withholdingCheck({
    refundCents: view.estimate.refundCents,
    withholdingKnown: view.withholdingKnown,
    marginalRate: view.estimate.marginalRate,
    perYear: view.paychecks.perYear,
    paychecksLeft: view.paychecks.left,
    withheldPerPaycheckCents: view.paychecks.withheldPerPaycheckCents,
    lastYearRefundCents: view.lastYearRefundCents,
  });
}

export async function loadWithholding(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<WithholdingView> {
  const [estimate, advice] = await Promise.all([
    loadTaxEstimate(userId, { client, now }),
    adviceMode(userId, { client }),
  ]);
  return { estimate, check: checkFrom(estimate), advice };
}

// "I've sent it": the W-4 change the person made, counted in the estimate from that day.
export async function recordW4Change(
  userId: string,
  change: { step: W4Step; amountCents: number },
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<void> {
  if (change.step !== "4b" && change.step !== "4c")
    throw new WithholdingError("Pick 4(b) or 4(c).");
  if (!Number.isInteger(change.amountCents) || change.amountCents <= 0) {
    throw new WithholdingError("The amount must be more than zero.");
  }
  const { estimate } = await loadWithholding(userId, { client, now });
  const data = {
    w4Step: change.step,
    w4AmountCents: change.amountCents,
    w4ChangedOn: new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`),
    w4Year: estimate.year,
  };
  await scopedFor(userId, client).taxProfiles.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  await logAudit(
    { type: "user", id: userId },
    "tax_profile_changed",
    { type: "user", id: userId },
    { fields: "w4", via },
  );
  await track(userId, "tax_w4_sent", { step: change.step, via });
}

// Undo: the W-4 change isn't counted any more.
export async function clearW4Change(
  userId: string,
  { client = defaultClient, via }: Options & { via: "chat" | "page" },
): Promise<void> {
  await scopedFor(userId, client).taxProfiles.updateMany({
    data: { w4Step: null, w4AmountCents: null, w4ChangedOn: null, w4Year: null },
  });
  await track(userId, "tax_w4_cleared", { via });
}

// "Keep my refund": no more W-4 suggestions for a big refund this tax year.
export async function keepRefund(
  userId: string,
  year: number,
  { client = defaultClient, via }: Options & { via: "chat" | "page" },
): Promise<void> {
  await scopedFor(userId, client).taxProfiles.upsert({
    where: { userId },
    create: { userId, keepRefundYear: year },
    update: { keepRefundYear: year },
  });
  await track(userId, "tax_refund_kept", { via });
}
