import {
  MAX_HOUSEHOLD_PEOPLE,
  MAX_PERSON_NAME_LENGTH,
  isHouseholdRelation,
  isPolicyKind,
  type PolicyKind,
} from "@/config/insurance";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor, sharedReadFor } from "@/lib/db-scoped";
import {
  compareFamilyHealth,
  familyHealthGap,
  readPeople,
  spouseHealthGaps,
  teenDriverGaps,
  whoIsCovered,
  type CoverRow,
  type FamilyGap,
  type FamilyHealthRow,
  type FamilyPolicy,
  type Person,
} from "./family-rules";
import { expectedSpend } from "./health";
import { loadHousehold, type Household } from "./household";
import { listPolicies, type Policy } from "./policies";
import { readCoverage } from "./coverage";
import { PREMIUM_FREQUENCIES, type PremiumFrequency } from "@/config/documents";

// The whole household's cover (spec step 198). One view of the person's own policies and the
// ones a household partner chose to share (read-only, and only those), who is covered by
// what, the gaps for each person, and the family health plan comparison. Partners see what
// is shared and nothing else, as everywhere else in the household.

type Options = { client?: PrismaClient; now?: Date };

export class FamilyError extends Error {}

export type Family = {
  people: Person[];
  partners: string[];
  policies: FamilyPolicy[];
  rows: CoverRow[];
  gaps: FamilyGap[];
  healthPlans: FamilyHealthRow[];
  // The policy that covers the household now, for the comparison.
  currentHealthId: string | null;
};

const nameOf = (u: { name: string | null; email: string }) =>
  u.name?.trim() || u.email.split("@")[0];

const own = (p: Policy): FamilyPolicy => ({
  id: p.id,
  kind: p.kind,
  carrier: p.carrier,
  owner: "You",
  shared: p.sharedWithHousehold === true,
  employer: p.source === "employer",
  premiumCents: p.premiumCents,
  premiumFrequency: p.premiumFrequency,
  deductibleCents: p.deductibleCents,
  coverage: p.coverage,
  covered: p.covered ?? [],
});

export async function loadFamily(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    given,
  }: Options & { given?: { policies: Policy[]; household: Household } } = {},
): Promise<Family> {
  const db = scopedFor(userId, client);
  const [mine, profile, shared, household] = await Promise.all([
    given ? given.policies : listPolicies(userId, { client }),
    db.insuranceProfiles.findFirst({ select: { people: true } }),
    sharedReadFor(userId, client),
    given ? given.household : loadHousehold(userId, { client, now }),
  ]);
  const people = readPeople(profile?.people);
  const names = new Map(shared.partners.map((p) => [p.userId, nameOf(p)]));
  const theirs = (await shared.policies()).map((r): FamilyPolicy => {
    const kind: PolicyKind = isPolicyKind(r.kind) ? r.kind : "other";
    return {
      id: r.id,
      kind,
      carrier: r.carrier,
      owner: names.get(r.userId) ?? "A partner",
      shared: true,
      employer: r.source === "employer",
      premiumCents: r.premiumCents,
      premiumFrequency:
        r.premiumFrequency && Object.hasOwn(PREMIUM_FREQUENCIES, r.premiumFrequency)
          ? (r.premiumFrequency as PremiumFrequency)
          : null,
      deductibleCents: r.deductibleCents,
      coverage: readCoverage(kind, r.coverage),
      covered: readPeople(r.covered),
    };
  });
  const policies = [...mine.filter((p) => p.status === "active").map(own), ...theirs];
  const partners = [...names.values()];
  const { rows, policies: once } = whoIsCovered(people, policies, partners);

  // Everyone the plans would have to cover: you, each listed person, and any partner not
  // already listed as a spouse.
  const listedSpouse = people.some((p) => p.relation === "spouse");
  const size = 1 + people.length + (listedSpouse ? 0 : partners.length);
  const healthPlans = compareFamilyHealth(once, size, expectedSpend(household));
  // The plan covering most people now is the one the household is on.
  const currentHealth =
    [...once.filter((p) => p.kind === "health")].sort(
      (a, b) => b.covered.length - a.covered.length,
    )[0] ?? null;
  const gaps = [
    ...teenDriverGaps(people, once),
    ...spouseHealthGaps(people, once, partners),
    ...[familyHealthGap(healthPlans, currentHealth?.id ?? null)].flatMap((g) => (g ? [g] : [])),
  ];
  return {
    people,
    partners,
    policies: once,
    rows,
    gaps,
    healthPlans,
    currentHealthId: currentHealth?.id ?? null,
  };
}

// Who else lives with the person, for matching cover to them. Replaces the list.
export async function savePeople(
  userId: string,
  people: Person[],
  { client = defaultClient }: Options = {},
): Promise<Person[]> {
  const clean = readPeople(people);
  if (clean.length !== people.length)
    throw new FamilyError("Each person needs a name and a relation.");
  if (clean.length > MAX_HOUSEHOLD_PEOPLE) {
    throw new FamilyError(`You can list up to ${MAX_HOUSEHOLD_PEOPLE} people.`);
  }
  if (clean.some((p) => p.name.length > MAX_PERSON_NAME_LENGTH)) {
    throw new FamilyError(`Keep names under ${MAX_PERSON_NAME_LENGTH} characters.`);
  }
  if (new Set(clean.map((p) => p.name.toLowerCase())).size !== clean.length) {
    throw new FamilyError("Two people have the same name.");
  }
  await scopedFor(userId, client).insuranceProfiles.upsert({
    where: { userId },
    create: { userId, people: clean as unknown as Prisma.InputJsonArray },
    update: { people: clean as unknown as Prisma.InputJsonArray },
  });
  await track(userId, "insurance_people_saved", { people: clean.length });
  return clean;
}

export async function addPerson(
  userId: string,
  input: { name: string; relation: string; driver: boolean; age: string },
  { client = defaultClient }: Options = {},
): Promise<Person[]> {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name) throw new FamilyError("Enter their name.");
  if (!isHouseholdRelation(input.relation)) throw new FamilyError("Pick who they are to you.");
  const ageText = input.age.trim();
  const age = ageText === "" ? null : Number(ageText);
  if (age !== null && (!Number.isInteger(age) || age < 0 || age > 120)) {
    throw new FamilyError("Enter their age in whole years.");
  }
  const current = readPeople(
    (await scopedFor(userId, client).insuranceProfiles.findFirst({ select: { people: true } }))
      ?.people,
  );
  return savePeople(
    userId,
    [...current, { name, relation: input.relation, driver: input.driver, age }],
    { client },
  );
}

export async function removePerson(
  userId: string,
  name: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const current = readPeople(
    (await db.insuranceProfiles.findFirst({ select: { people: true } }))?.people,
  );
  await savePeople(
    userId,
    current.filter((p) => p.name.toLowerCase() !== name.toLowerCase()),
    { client },
  );
  // And off the policies that listed them.
  for (const policy of await listPolicies(userId, { client })) {
    const covered = policy.covered ?? [];
    if (covered.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      await db.insurancePolicies.updateMany({
        where: { id: policy.id },
        data: {
          covered: covered.filter(
            (c) => c.name.toLowerCase() !== name.toLowerCase(),
          ) as unknown as Prisma.InputJsonArray,
        },
      });
    }
  }
}

// Whether a listed person is covered by a policy of the person's own.
export async function setCovered(
  userId: string,
  policyId: string,
  name: string,
  covered: boolean,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const people = readPeople(
    (await db.insuranceProfiles.findFirst({ select: { people: true } }))?.people,
  );
  const person = people.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!person) throw new FamilyError("That person isn't in your household.");
  const policy = (await listPolicies(userId, { client })).find((p) => p.id === policyId);
  if (!policy) throw new FamilyError("That isn't one of your policies.");
  const now = (policy.covered ?? []).filter(
    (c) => c.name.toLowerCase() !== person.name.toLowerCase(),
  );
  await db.insurancePolicies.updateMany({
    where: { id: policyId },
    data: { covered: (covered ? [...now, person] : now) as unknown as Prisma.InputJsonArray },
  });
  await track(userId, "insurance_covered_set", { kind: policy.kind, covered });
}

// Show a policy to the household, or stop. Only the policy holder can.
export async function setShared(
  userId: string,
  policyId: string,
  shared: boolean,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const { count } = await scopedFor(userId, client).insurancePolicies.updateMany({
    where: { id: policyId, status: { not: "removed" } },
    data: { sharedWithHousehold: shared },
  });
  if (count === 0) throw new FamilyError("That isn't one of your policies.");
  await track(userId, "insurance_policy_sharing_set", { shared });
}

// The family's gaps as the profile's gaps: no policy of their own to point at.
export const familyGapsOf = (family: Pick<Family, "gaps">) =>
  family.gaps.map((g) => ({ ...g, policyId: null }));
