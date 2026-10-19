import { POLICY_KINDS, type GapKey, type PolicyKind } from "@/config/insurance";
import { isLiabilityOnly } from "./coverage";
import type { Household } from "./household";
import type { Policy } from "./policies";

// Coverage gaps by rules (spec step 102): renting with no renters cover, owning with no
// home cover, a car with no car insurance, dependants with no life cover, and a car
// insured for liability only. Each says in plain words what's missing and why it matters,
// from the household facts and the policies on file. Pure. What to add is advice, said
// only in demo advice mode (spec step 98).

export type Gap = {
  key: GapKey;
  // The kind of policy that would close it.
  kind: PolicyKind;
  // The policy it's about, for liability only.
  policyId: string | null;
  title: string;
  // Why it matters, in plain words: what's at stake, never what to buy.
  why: string;
};

const has = (policies: Policy[], ...kinds: PolicyKind[]) =>
  policies.some((p) => p.status === "active" && kinds.includes(p.kind));

const from = (fact: { from: "you" | "accounts" | null }, typed: string, accounts: string) =>
  fact.from === "you" ? typed : accounts;

export function coverageGaps(household: Household, policies: Policy[]): Gap[] {
  const gaps: Gap[] = [];
  const { housing, vehicles, dependants } = household;

  if (housing.value === "rent" && !has(policies, "renters", "home")) {
    gaps.push({
      key: "renters",
      kind: "renters",
      policyId: null,
      title: "No renters insurance on file",
      why: `${from(housing, "You told me you rent", "Your payments show rent")}, and there's no renters policy on your profile. Your landlord's insurance covers the building, not your things or damage you cause to others.`,
    });
  }
  if (housing.value === "own" && !has(policies, "home")) {
    gaps.push({
      key: "home",
      kind: "home",
      policyId: null,
      title: "No home insurance on file",
      why: `${from(housing, "You told me you own your home", "You have a mortgage or a home on your profile")}, and there's no home policy on it. If your mortgage pays it from escrow, add it here so I can keep an eye on it too.`,
    });
  }
  if ((vehicles.value ?? 0) > 0 && !has(policies, "auto")) {
    gaps.push({
      key: "auto",
      kind: "auto",
      policyId: null,
      title: "No car insurance on file",
      why: `${from(vehicles, "You told me you have a car", "You have a car loan or a car on your profile")}, and there's no car policy on file. Almost every state requires car insurance to drive.`,
    });
  }
  if ((dependants.value ?? 0) > 0 && !has(policies, "life")) {
    gaps.push({
      key: "life",
      kind: "life",
      policyId: null,
      title: "No life insurance on file",
      why: `You told me ${dependants.value === 1 ? "someone depends" : `${dependants.value} people depend`} on you, and there's no life policy on file. Life insurance pays the people who depend on you if you die.`,
    });
  }
  const liabilityOnly = policies.find(
    (p) => p.status === "active" && isLiabilityOnly(p.kind, p.coverage),
  );
  if (liabilityOnly) {
    gaps.push({
      key: "liability_only",
      kind: "auto",
      policyId: liabilityOnly.id,
      title: `Your ${liabilityOnly.carrier} car policy only covers others`,
      why: "It has no collision or comprehensive cover, so it pays for damage you cause to other people and their cars, not for damage to your own car or if it's stolen.",
    });
  }
  return gaps.filter((g) => !household.dismissedGaps.includes(g.key));
}

// "car insurance", "renters insurance".
export const kindWords = (kind: PolicyKind) =>
  kind === "other" ? "insurance" : `${POLICY_KINDS[kind].toLowerCase()} insurance`;
