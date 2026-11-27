import { TUITION_PAYEE } from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { childrenOrUnknownAges } from "@/lib/family-taxes";
import { loadTaxDocuments } from "@/lib/tax-documents";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadTaxTags } from "@/lib/tax-organizer";
import { listPriorReturns } from "@/lib/prior-return";
import { reviewReturn, type Fields, type Review } from "@/planning/prior-return";
import { todayOf } from "@/lib/today";

// Last year's return, reviewed (spec step 172): a confirmed return checked against what
// Jane knows for that year (demo advice: it recommends amending). Only a return the
// person confirmed is ever used.

type Options = { client?: PrismaClient; now?: Date };

// Jane keeps no record of the household for a past year (no snapshot), so a review of one reads it
// as it is today; said once, in plain words, with the review.
export const householdAsToday = (year: number) =>
  `This uses your household as it is today, because Jane has no record of it for ${year}.`;

export type ReturnReview = Review & {
  householdNote: string;
  filed: Fields;
  returnId: string;
  amendment: AmendmentView | null;
};

export type AmendmentView = {
  id: string;
  year: number;
  status: "ready_for_review" | "submitted" | "accepted" | "rejected";
  changes: { key: string; title: string; savesCents: number }[];
  refundCents: number;
  signerName: string | null;
};

export async function loadReturnReviews(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ advice: boolean; reviews: ReturnReview[] }> {
  const advice = await adviceMode(userId, { client });
  if (!advice) return { advice, reviews: [] };
  const confirmed = (await listPriorReturns(userId, { client, status: "confirmed" })).filter(
    (r) => r.year !== null,
  );
  const db = scopedFor(userId, client);
  const reviews: ReturnReview[] = [];
  for (const r of confirmed) {
    const year = r.year!;
    const [estimate, tags, docs, amendment, family] = await Promise.all([
      loadTaxEstimate(userId, { client, now, year }),
      loadTaxTags(userId, year, { client }),
      loadTaxDocuments(userId, year, { client, now }),
      db.taxAmendments.findFirst({ where: { year } }),
      db.taxProfiles.findFirst({
        select: {
          spouseWagesCents: true,
          studentYearsBefore: true,
          studentHalfTime: true,
          familyChildren: true,
        },
      }),
    ]);
    // What the person told Jane about the household; left out when they haven't, so the credits
    // that need it are held back rather than assumed.
    const married =
      estimate.input.filingStatus === "married_joint" ||
      estimate.input.filingStatus === "married_separate";
    const bothWork = !married
      ? true
      : family?.spouseWagesCents == null
        ? undefined
        : family.spouseWagesCents > 0;
    const studentFacts =
      family?.studentYearsBefore == null || family.studentHalfTime == null
        ? undefined
        : {
            yearsOfCollegeBefore: family.studentYearsBefore,
            halfTime: family.studentHalfTime,
          };
    // Every usable student-loan form, not the first: two loans are two forms (CodeRabbit sweep).
    const studentForms = docs.forms.filter(
      (f) => f.formKey === "student" && f.document && f.usable,
    );
    const review = reviewReturn({
      year,
      today: await todayOf(userId, { client, now }),
      filed: r.fields,
      input: estimate.input,
      studentLoanInterestCents: studentForms.length
        ? studentForms.reduce((sum, f) => sum + (f.document?.boxes.interest ?? 0), 0)
        : estimate.input.studentLoanInterestCents,
      tuitionCents: tags.tagged
        .filter((t) => t.tag === "education" && TUITION_PAYEE.test(t.payee))
        .reduce((s, t) => s + t.amountCents, 0),
      careCents: tags.totals.childcare.totalCents,
      bothWork,
      student: studentFacts,
      children: childrenOrUnknownAges(family?.familyChildren, estimate.input.childrenUnder17),
    });
    reviews.push({
      ...review,
      householdNote: householdAsToday(year),
      filed: r.fields,
      returnId: r.id,
      amendment: amendment
        ? {
            id: amendment.id,
            year,
            status: amendment.status as AmendmentView["status"],
            changes: amendment.changes as AmendmentView["changes"],
            refundCents: amendment.refundCents,
            signerName: amendment.signerName,
          }
        : null,
    });
  }
  return { advice, reviews };
}
