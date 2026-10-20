import { PREMIUM_FREQUENCIES, type PremiumFrequency } from "@/config/documents";
import {
  FAMILY_HEALTH_MIN_SAVING_CENTS,
  HEALTH_EXTRA_PERSON_SHARE,
  TEEN_DRIVER_MAX_AGE,
  isHouseholdRelation,
  type GapKey,
  type HouseholdRelation,
  type PolicyKind,
} from "@/config/insurance";
import { formatCents } from "@/lib/money";
import type { Coverage } from "./coverage";
import { expectedYearlyCost } from "./health";

// The whole household's cover (spec step 198): who is covered by what, the gaps for each
// person, and a family health plan comparison that counts both partners' employer plans.
// Pure. A person's policies and the policies a partner chose to share are the only ones
// that ever reach it.

export type Person = {
  name: string;
  relation: HouseholdRelation;
  driver: boolean;
  age: number | null;
};

export type FamilyPolicy = {
  id: string;
  kind: PolicyKind;
  carrier: string;
  // "You", or the partner's name.
  owner: string;
  shared: boolean;
  // Employer-provided (a plan through a job), for the health comparison.
  employer: boolean;
  premiumCents: number | null;
  premiumFrequency: PremiumFrequency | null;
  deductibleCents: number | null;
  coverage: Coverage;
  // Who else it covers, besides its holder.
  covered: Person[];
};

// Parses the stored people list, ignoring anything malformed.
export function readPeople(value: unknown): Person[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): Person[] => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name || !isHouseholdRelation(r.relation)) return [];
    const age = typeof r.age === "number" && Number.isInteger(r.age) && r.age >= 0 ? r.age : null;
    return [{ name, relation: r.relation, driver: r.driver === true, age }];
  });
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const coversPerson = (p: FamilyPolicy, person: Person) =>
  p.covered.some((c) => same(c.name, person.name));
const yearly = (p: FamilyPolicy) =>
  p.premiumCents !== null && p.premiumFrequency
    ? p.premiumCents * PREMIUM_FREQUENCIES[p.premiumFrequency].perYear
    : null;

export type CoverRow = {
  name: string;
  relation: HouseholdRelation | "you";
  // The policies that cover them, with whose they are.
  policies: { id: string; kind: PolicyKind; carrier: string; owner: string }[];
};

// Who is covered by what: you (on your own policies), each person you listed (on the
// policies that list them) and each partner (on their shared ones). A policy shared by
// more than one household member and the same in every way shows once.
export function whoIsCovered(
  people: Person[],
  policies: FamilyPolicy[],
  partnerNames: string[],
): { rows: CoverRow[]; policies: FamilyPolicy[] } {
  const seen = new Set<string>();
  const once = policies.filter((p) => {
    const key = [
      p.kind,
      p.carrier.toLowerCase(),
      p.premiumCents,
      p.premiumFrequency,
      p.shared,
    ].join("|");
    if (p.shared && seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const brief = (p: FamilyPolicy) => ({
    id: p.id,
    kind: p.kind,
    carrier: p.carrier,
    owner: p.owner,
  });
  return {
    policies: once,
    rows: [
      { name: "You", relation: "you", policies: once.filter((p) => p.owner === "You").map(brief) },
      ...partnerNames.map((name) => ({
        name,
        relation: "spouse" as const,
        policies: once.filter((p) => same(p.owner, name)).map(brief),
      })),
      ...people.map((person) => ({
        name: person.name,
        relation: person.relation,
        policies: once.filter((p) => coversPerson(p, person)).map(brief),
      })),
    ],
  };
}

export type FamilyGap = { key: GapKey; kind: PolicyKind; title: string; why: string };

// A listed driver this age or younger who is on no car policy.
export function teenDriverGaps(people: Person[], policies: FamilyPolicy[]): FamilyGap[] {
  const cars = policies.filter((p) => p.kind === "auto");
  return people
    .filter((p) => p.driver && p.age !== null && p.age <= TEEN_DRIVER_MAX_AGE)
    .filter((p) => !cars.some((c) => coversPerson(c, p)))
    .map((p) => ({
      key: "teen_driver",
      kind: "auto",
      title: `${p.name} isn't on a car policy`,
      why: `${p.name} is ${p.age} and drives, and no car policy on your profile or your household's lists them. A new teen driver usually raises the price, and a driver who isn't listed can leave a claim in doubt.`,
    }));
}

// A spouse or partner who is on no health plan: not listed on yours, and no plan of their
// own shared with the household.
export function spouseHealthGaps(
  people: Person[],
  policies: FamilyPolicy[],
  partnerNames: string[],
): FamilyGap[] {
  const health = policies.filter((p) => p.kind === "health");
  const partnerHasPlan = health.some((p) => partnerNames.some((n) => same(p.owner, n)));
  return people
    .filter((p) => p.relation === "spouse")
    .filter((p) => !partnerHasPlan && !health.some((h) => coversPerson(h, p)))
    .map((p) => ({
      key: "spouse_health",
      kind: "health",
      title: `${p.name} isn't on a health plan`,
      why: `${p.name} isn't listed on your health plan, and I don't see a plan of their own. Without one, a hospital stay could cost tens of thousands of dollars.`,
    }));
}

export type FamilyHealthRow = {
  policyId: string;
  label: string;
  employer: boolean;
  // What the whole household would pay in a year on this plan, with the care they usually
  // need: the premium for everyone plus what they'd pay themselves.
  familyYearlyCents: number;
  // The plan's premium alone for the household.
  premiumYearlyCents: number;
};

// A plan's premium for `size` people when it now covers `now` people: one price per person
// worked out from today's premium, with each extra person at HEALTH_EXTRA_PERSON_SHARE.
function premiumForFamily(yearlyNow: number, now: number, size: number): number {
  const perFirst = yearlyNow / (1 + HEALTH_EXTRA_PERSON_SHARE * Math.max(0, now - 1));
  return Math.round(perFirst * (1 + HEALTH_EXTRA_PERSON_SHARE * Math.max(0, size - 1)));
}

// Every health plan in the household, priced for the whole household: yours and each
// partner's employer plan. Plans with unknown terms are left out.
export function compareFamilyHealth(
  policies: FamilyPolicy[],
  familySize: number,
  spendCents: number,
): FamilyHealthRow[] {
  return policies
    .filter((p) => p.kind === "health")
    .flatMap((p): FamilyHealthRow[] => {
      const now = yearly(p);
      if (now === null) return [];
      const premium = premiumForFamily(now, 1 + p.covered.length, familySize);
      // Care costs are for the whole household: the plan's deductible and most apply per family.
      const total = expectedYearlyCost(p, premium, spendCents * familySize);
      return total === null
        ? []
        : [
            {
              policyId: p.id,
              label: `${p.owner === "You" ? "Your" : `${p.owner}'s`} ${p.carrier} plan`,
              employer: p.employer,
              familyYearlyCents: total,
              premiumYearlyCents: premium,
            },
          ];
    })
    .sort((a, b) => a.familyYearlyCents - b.familyYearlyCents);
}

// The cheaper plan for the family, when it saves enough over the one that covers them now.
export function familyHealthGap(
  rows: FamilyHealthRow[],
  currentPolicyId: string | null,
): FamilyGap | null {
  if (rows.length < 2) return null;
  const best = rows[0];
  const current = rows.find((r) => r.policyId === currentPolicyId) ?? rows.at(-1)!;
  const saving = current.familyYearlyCents - best.familyYearlyCents;
  if (best.policyId === current.policyId || saving < FAMILY_HEALTH_MIN_SAVING_CENTS) return null;
  return {
    key: "family_health_plan",
    kind: "health",
    title: `${best.label} may cost your family less`,
    why: `For everyone in your household, with the care you usually need, ${best.label} comes to about ${formatCents(best.familyYearlyCents)} a year against ${formatCents(current.familyYearlyCents)} on ${current.label}: about ${formatCents(saving)} less. Moving takes open enrollment or a life event.`,
  };
}
