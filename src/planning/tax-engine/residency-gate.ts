import { formatCents } from "@/lib/money";
import type { TaxEstimate } from "@/planning/tax-estimate";

// The residency gate (tax program step T10, part 1). Some credits are not open to a nonresident
// alien, and an F or J student is usually one for the first five calendar years. Jane never
// assumes: a credit that is for residents only is shown only to someone who told Jane they are a US
// citizen or green card holder; for everyone else (not asked yet, "not sure", a student visa,
// another visa) it is held back, and what is held back says it depends on that answer. Pure.
//
// Why only "citizen" opens the gate: a green card holder is answered as "citizen" (the question
// reads "Citizen or green card"), and every other answer leaves the status open or a nonresident.
// "Another visa" is held too: on a work visa the substantial presence test often makes a person a
// resident for tax, but it turns on days in the US that Jane does not know (Pub. 519, chapter 1).

// What Jane's profile facts look like to this module: only the fact's value is read.
export type FactsLike = Record<string, { value: unknown } | undefined>;

export type ResidencyKind = "citizen" | "student_visa" | "other_visa" | "unknown";

export function residencyKind(value: unknown): ResidencyKind {
  return value === "citizen" || value === "student_visa" || value === "other_visa"
    ? value
    : "unknown";
}

// True only for a person who told Jane they are a citizen or green card holder.
export const residentOnlyAllowedFor = (value: unknown): boolean => value === "citizen";

export const residentOnlyAllowed = (facts: FactsLike): boolean =>
  residentOnlyAllowedFor(facts.tax_residency?.value);

// Verified at the source on 2026-11-27 (the edition for 2025 returns is the latest the IRS has
// published; its 2026 edition is not out). Chapter 5, "Tax Credits and Payments", section
// "Nonresident Aliens", subsection "Credits".
export const RESIDENCY_SOURCE = {
  name: "IRS Publication 519, U.S. Tax Guide for Aliens",
  edition: "2025",
  url: "https://www.irs.gov/publications/p519",
  checkedOn: "2026-11-27",
} as const;

// The suggestion topics for resident-only credits, and the ones that stay open to a nonresident
// alien, each with where Publication 519 says so.
export const RESIDENT_ONLY_TOPICS = {
  education_credit: {
    where: 'Chapter 5, Credits (nonresident aliens), "Education credits"',
    says: "a nonresident alien for any part of the year generally cannot claim the education credits (a joint return with a US citizen or resident spouse, or choosing resident status for the whole year, are the ways in)",
  },
  earned_income_credit: {
    where: 'Chapter 5, Credits (nonresident aliens), "Earned income credit (EIC)"',
    says: "a nonresident alien for any part of the year generally cannot claim the EIC (a joint return with a US citizen or resident spouse is the way in)",
  },
} as const;

export const OPEN_TO_NONRESIDENTS = {
  savers_credit: {
    where: 'Chapter 5, Credits (nonresident aliens), "Retirement savings contributions credit"',
    says: "listed among the credits a nonresident alien may qualify for",
  },
  student_loan_interest: {
    where: 'Chapter 5, Deductions (nonresident aliens), "Student loan interest deduction"',
    says: "a nonresident alien who paid interest on a qualified student loan may be able to deduct up to $2,500 (Schedule 1, line 21, attached to Form 1040-NR)",
  },
} as const;

export type ResidentOnlyTopic = keyof typeof RESIDENT_ONLY_TOPICS;

// Fact wording (W-F), the same on every surface that holds a resident-only credit back.
export const RESIDENCY_NOTE =
  "Some credits are usually not open to nonresident aliens. F-1 and J-1 students are usually nonresident for US tax for their first five calendar years (IRS Publication 519).";

// Why a resident-only credit is held, by what Jane knows about the person.
export function heldReason(kind: ResidencyKind): string {
  if (kind === "student_visa")
    return "F-1 and J-1 students are usually nonresident for US tax for their first five calendar years, and nonresident aliens generally can't take it (IRS Publication 519).";
  if (kind === "other_visa")
    return "on another visa, whether you count as a resident for US tax depends on your days in the US, and nonresident aliens generally can't take it (IRS Publication 519).";
  return "it depends on whether you're a US citizen or resident for tax, which I don't have yet.";
}

// A side of a comparison that is held (src/planning/family-taxes.ts): not open to a student visa
// holder (said so), otherwise "may be open" until the status is known.
export function educationHeldWhy(kind: ResidencyKind): { open: boolean; why: string } {
  if (kind === "student_visa")
    return {
      open: false,
      why: "The education credits are usually not open to nonresident aliens, and F-1 and J-1 students usually are nonresident for their first five calendar years (IRS Publication 519).",
    };
  return {
    open: true,
    why:
      kind === "other_visa"
        ? "May be open to you: the education credits are for US citizens and residents for tax, and on another visa that depends on your days in the US (IRS Publication 519)."
        : "May be open to you: the education credits are for US citizens and residents for tax, and I don't have your status yet. Nonresident aliens generally can't take them (IRS Publication 519).",
  };
}

// The estimate's assumption line for an earned income credit that would have counted.
export function earnedIncomeHeldLine(kind: ResidencyKind, upToCents: number): string {
  const tail = kind === "unknown" ? " Tell me and I'll check it." : "";
  return `I haven't counted the Earned Income Credit (up to ${formatCents(upToCents)}): ${heldReason(kind)}${tail}`;
}

// The estimate with the earned income credit taken out: what the pure estimator
// (src/planning/tax-estimate.ts) says when the person's status is not established. The credit
// lowered the total tax and raised the refund, so both go back.
export function withoutEarnedIncomeCredit(e: TaxEstimate): TaxEstimate {
  const credit = e.credits.earnedIncomeCreditCents;
  if (credit === 0) return e;
  return {
    ...e,
    credits: { ...e.credits, earnedIncomeCreditCents: 0 },
    totalTaxCents: e.totalTaxCents + credit,
    refundCents: e.refundCents - credit,
  };
}
