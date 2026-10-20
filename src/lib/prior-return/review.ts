import { TUITION_PAYEE } from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadTaxDocuments } from "@/lib/tax-documents";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadTaxTags } from "@/lib/tax-organizer";
import { listPriorReturns } from "@/lib/prior-return";
import { reviewReturn, type Fields, type Review } from "@/planning/prior-return";

// Last year's return, reviewed (spec step 172): a confirmed return checked against what
// Jane knows for that year (demo advice: it recommends amending). Only a return the
// person confirmed is ever used.

type Options = { client?: PrismaClient; now?: Date };

export type ReturnReview = Review & {
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
    const [estimate, tags, docs, amendment] = await Promise.all([
      loadTaxEstimate(userId, { client, now, year }),
      loadTaxTags(userId, year, { client }),
      loadTaxDocuments(userId, year, { client, now }),
      db.taxAmendments.findFirst({ where: { year } }),
    ]);
    const student = docs.forms.find((f) => f.formKey === "student" && f.document && f.usable);
    const review = reviewReturn({
      year,
      today: now.toISOString().slice(0, 10),
      filed: r.fields,
      input: estimate.input,
      studentLoanInterestCents:
        student?.document?.boxes.interest ?? estimate.input.studentLoanInterestCents,
      tuitionCents: tags.tagged
        .filter((t) => t.tag === "education" && TUITION_PAYEE.test(t.payee))
        .reduce((s, t) => s + t.amountCents, 0),
      careCents: tags.totals.childcare.totalCents,
      children: Array.from({ length: estimate.input.childrenUnder17 }, () => ({
        ageAtYearEnd: 5,
        hasSsn: true,
        monthsLivedWithYou: 12,
      })),
    });
    reviews.push({
      ...review,
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
