import { TUITION_PAYEE } from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadCollege } from "@/lib/investments/college";
import { loadTaxEstimate, type TaxEstimateView } from "@/lib/tax-estimate";
import { loadTaxTags } from "@/lib/tax-organizer";
import {
  careChoice,
  childrenChoice,
  educationChoice,
  filingChoice,
  plan529Choice,
  type Child,
  type FamilyChoice,
  type Student,
} from "@/planning/family-taxes";

// Family taxes (spec step 169), loaded from what Jane knows: the children (the person's
// family details, else step 158's college plans, else the profile's count), childcare and
// tuition spending from the tax tags, a 529 from the college plans, a spouse's wages. In
// demo advice mode, each choice with both sides' tax. Choosing is always the person's.

type Options = { client?: PrismaClient; now?: Date };

export class FamilyTaxesError extends Error {}

export type FamilyView = {
  year: number;
  advice: boolean;
  choices: FamilyChoice[];
  // What Jane assumed, said plainly.
  assumptions: string[];
};

export type FamilyDetails = {
  children: Child[];
  spouseWagesCents: number | null;
  paysOverHalfHome: boolean | null;
  student: Student | null;
};

export function parseChildren(value: unknown): Child[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (c): c is Child =>
      typeof c === "object" &&
      c !== null &&
      Number.isInteger((c as Child).ageAtYearEnd) &&
      typeof (c as Child).hasSsn === "boolean" &&
      Number.isInteger((c as Child).monthsLivedWithYou),
  );
}

export async function loadFamilyTaxes(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & { loaded?: { estimate: TaxEstimateView; advice: boolean } } = {},
): Promise<FamilyView> {
  const [estimate, advice] = loaded
    ? [loaded.estimate, loaded.advice]
    : await Promise.all([loadTaxEstimate(userId, { client, now }), adviceMode(userId, { client })]);
  const year = estimate.year;
  if (!advice) return { year, advice, choices: [], assumptions: [] };
  const db = scopedFor(userId, client);
  const [stored, tags, college] = await Promise.all([
    db.taxProfiles.findFirst({
      select: {
        familyChildren: true,
        spouseWagesCents: true,
        paysOverHalfHome: true,
        studentYearsBefore: true,
        studentHalfTime: true,
      },
    }),
    loadTaxTags(userId, year, { client }),
    loadCollege(userId, { client, now }),
  ]);
  const input = estimate.input;
  const assumptions: string[] = [];

  let children = parseChildren(stored?.familyChildren);
  if (children.length === 0 && college.plans.length > 0) {
    children = college.plans.map((p) => ({
      ageAtYearEnd: p.age,
      hasSsn: true,
      monthsLivedWithYou: 12,
    }));
    assumptions.push(
      "Your children's ages come from your college plans; I've assumed each has a Social Security number and lives with you.",
    );
  }
  if (children.length === 0 && input.childrenUnder17 > 0) {
    // Ages unknown: under 13 when there's childcare spending, else under 17.
    const age = tags.totals.childcare.totalCents > 0 ? 5 : 14;
    children = Array.from({ length: input.childrenUnder17 }, () => ({
      ageAtYearEnd: age,
      hasSsn: true,
      monthsLivedWithYou: 12,
    }));
    assumptions.push(
      "I don't know your children's ages; add them under family details for exact answers.",
    );
  }

  const elapsed = estimate.elapsed > 0 && estimate.elapsed < 1 ? estimate.elapsed : 1;
  const careCents = Math.round(tags.totals.childcare.totalCents / elapsed);
  // Only tuition paid to a school counts for the education credits (not a course app).
  const tuitionCents = tags.tagged
    .filter((t) => t.tag === "education" && TUITION_PAYEE.test(t.payee))
    .reduce((sum, t) => sum + t.amountCents, 0);
  const student: Student = {
    yearsOfCollegeBefore: stored?.studentYearsBefore ?? 0,
    halfTime: stored?.studentHalfTime ?? true,
  };
  if (tuitionCents > 0 && stored?.studentYearsBefore == null) {
    assumptions.push(
      "I've assumed the student is in their first four years of college, at least half-time.",
    );
  }
  const married =
    input.filingStatus === "married_joint" || input.filingStatus === "married_separate";
  const spouseWages = stored?.spouseWagesCents ?? null;
  if (married && spouseWages === null) {
    assumptions.push(
      "Add your spouse's wages under family details to compare filing jointly and separately.",
    );
  }
  const yearly529 = college.plans.reduce(
    (s, p) =>
      s + Math.round(((p.estimate.monthly.lowCents + p.estimate.monthly.highCents) / 2) * 12),
    0,
  );

  const choices = [
    childrenChoice(input, children),
    careChoice({
      estimate: input,
      careCents,
      children,
      bothWork: !married || (spouseWages ?? 0) > 0,
    }),
    educationChoice({ estimate: input, tuitionCents, student }),
    plan529Choice({ estimate: input, state: input.state, contributionCents: yearly529 }),
    married && spouseWages !== null
      ? filingChoice({
          estimate: input,
          married: true,
          spouseWagesCents: spouseWages,
          paysOverHalfHome: stored?.paysOverHalfHome ?? false,
        })
      : filingChoice({
          estimate: input,
          married: false,
          spouseWagesCents: 0,
          paysOverHalfHome: stored?.paysOverHalfHome ?? false,
        }),
  ].filter((c): c is FamilyChoice => c !== null);
  return { year, advice, choices, assumptions };
}

// The family details form. Checked here, whatever the page sent.
export async function saveFamilyDetails(
  userId: string,
  details: FamilyDetails,
  { client = defaultClient, via }: { client?: PrismaClient; via: "chat" | "page" },
): Promise<void> {
  for (const c of details.children) {
    if (!Number.isInteger(c.ageAtYearEnd) || c.ageAtYearEnd < 0 || c.ageAtYearEnd > 30) {
      throw new FamilyTaxesError("Give each child's age as a whole number.");
    }
    if (
      !Number.isInteger(c.monthsLivedWithYou) ||
      c.monthsLivedWithYou < 0 ||
      c.monthsLivedWithYou > 12
    ) {
      throw new FamilyTaxesError("Months lived with you must be 0 to 12.");
    }
  }
  if (
    details.spouseWagesCents !== null &&
    (!Number.isInteger(details.spouseWagesCents) || details.spouseWagesCents < 0)
  ) {
    throw new FamilyTaxesError("Your spouse's wages must be dollars and cents.");
  }
  if (
    details.student &&
    (!Number.isInteger(details.student.yearsOfCollegeBefore) ||
      details.student.yearsOfCollegeBefore < 0 ||
      details.student.yearsOfCollegeBefore > 10)
  ) {
    throw new FamilyTaxesError("Years of college must be a whole number.");
  }
  const data = {
    familyChildren: details.children.map((c) => ({ ...c })),
    spouseWagesCents: details.spouseWagesCents,
    paysOverHalfHome: details.paysOverHalfHome,
    studentYearsBefore: details.student?.yearsOfCollegeBefore ?? null,
    studentHalfTime: details.student?.halfTime ?? null,
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
    { fields: "family", via },
  );
  await track(userId, "tax_profile_answered", { fields: "family", via });
}
