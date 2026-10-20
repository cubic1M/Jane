import {
  BUSINESS_EQUIPMENT_MIN_CENTS,
  BUSINESS_LIABILITY_TARGET_CENTS,
  BUSINESS_MILES_MIN,
  BUSINESS_MIN_INCOME_CENTS,
  type GapKey,
  type PolicyKind,
} from "@/config/insurance";
import { formatCents } from "@/lib/money";
import type { Policy } from "./policies";

// Business and side-gig cover (spec step 201): the gaps for someone who earns on the side,
// from the tax lane's self-employment signals (step 123) and the policies on file. A personal
// policy is never counted as covering business use: only a business policy closes the
// liability, professional and equipment gaps, and only a rideshare policy (or business use
// added to the car policy by the insurer) closes the car gap. Pure.

export type SelfEmployment = {
  // The tax profile says self-employed.
  declared: boolean;
  // Freelance and contract income in the last year, and gig (driving, delivery) income.
  serviceCents: number;
  gigCents: number;
  // Business miles this year, from the tax profile.
  miles: number;
  // Electronics bought in the last year, which a freelancer uses for work.
  equipmentCents: number;
};

export type BusinessGap = {
  key: GapKey;
  kind: PolicyKind;
  policyId: string | null;
  title: string;
  why: string;
  // Every dollar figure in the text, for the guardrails.
  cents: number[];
};

const active = (policies: Pick<Policy, "status" | "kind">[], kind: PolicyKind) =>
  policies.filter((p) => p.status === "active" && p.kind === kind) as Policy[];
const number = (value: unknown) => (typeof value === "number" ? value : 0);

// Whether they run a business: said so on the tax profile, or freelance or gig money came in.
export const runsBusiness = (s: SelfEmployment) =>
  s.declared || s.serviceCents + s.gigCents >= BUSINESS_MIN_INCOME_CENTS;

export function businessGaps(s: SelfEmployment | undefined, policies: Policy[]): BusinessGap[] {
  if (!s || !runsBusiness(s)) return [];
  const businessPolicies = active(policies, "business");
  const cars = active(policies, "auto");
  const gaps: BusinessGap[] = [];

  // Freelance or contract work (or nothing but a declaration): liability and professional.
  const freelance = s.declared || s.serviceCents >= BUSINESS_MIN_INCOME_CENTS;
  if (freelance) {
    const liability = Math.max(
      0,
      ...businessPolicies.map((p) => number(p.coverage.generalLiability)),
    );
    if (liability < BUSINESS_LIABILITY_TARGET_CENTS) {
      gaps.push({
        key: "business_liability",
        kind: "business",
        policyId: null,
        title:
          businessPolicies.length > 0
            ? "Your business policy's liability cover is low"
            : "No business insurance on file",
        why:
          businessPolicies.length > 0
            ? `Your business policy covers ${formatCents(liability)} of liability. Many clients ask for ${formatCents(BUSINESS_LIABILITY_TARGET_CENTS)}.`
            : "Your freelance or contract income is business income. Your home, renters and car policies cover your personal life, not a client who is hurt or whose property you damage while you work.",
        cents: businessPolicies.length > 0 ? [liability, BUSINESS_LIABILITY_TARGET_CENTS] : [],
      });
    }
    if (!businessPolicies.some((p) => number(p.coverage.professionalLiability) > 0)) {
      gaps.push({
        key: "professional_liability",
        kind: "business",
        policyId: null,
        title: "No professional liability cover on file",
        why: "You do freelance or contract work. If a client says your work or advice cost them money, general liability and personal policies don't pay for your defence or the claim.",
        cents: [],
      });
    }
  }

  // Driving for work: business use isn't in a personal car policy.
  const rideshare = active(policies, "rideshare").length > 0;
  if (cars.length > 0 && !rideshare && (s.gigCents > 0 || s.miles >= BUSINESS_MILES_MIN)) {
    gaps.push({
      key: "car_business_use",
      kind: s.gigCents > 0 ? "rideshare" : "auto",
      policyId: cars[0].id,
      title: "Your car policy may not cover driving for work",
      why:
        s.gigCents > 0
          ? "Your income shows driving or delivery work. A personal car policy covers personal trips and commuting, and often excludes driving for pay."
          : `You logged ${s.miles.toLocaleString("en-US")} business miles this year. A personal car policy covers personal trips and commuting, not work driving, unless the insurer adds business use.`,
      cents: [],
    });
  }

  // Equipment: a business policy's property cover, not home or renters.
  if (
    s.equipmentCents >= BUSINESS_EQUIPMENT_MIN_CENTS &&
    !businessPolicies.some((p) => number(p.coverage.businessProperty) > 0)
  ) {
    gaps.push({
      key: "business_equipment",
      kind: "business",
      policyId: null,
      title: "Your work equipment may not be covered",
      why: `You bought ${formatCents(s.equipmentCents)} of electronics this year. Home and renters policies usually cap equipment used for work at a small limit, or exclude it.`,
      cents: [s.equipmentCents],
    });
  }
  return gaps;
}
