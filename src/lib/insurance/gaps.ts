import {
  GAP_ADVICE,
  POLICY_KINDS,
  TRAVEL_GAP_MIN_CENTS,
  UMBRELLA_ASSETS_CENTS,
  type GapKey,
  type PolicyKind,
} from "@/config/insurance";
import { formatCents } from "@/lib/money";
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
  gaps.push(...moreGaps(household, policies));
  return gaps.filter((g) => !household.dismissedGaps.includes(g.key));
}

// "car insurance", "renters insurance".
export const kindWords = (kind: PolicyKind) =>
  kind === "other" ? "insurance" : `${POLICY_KINDS[kind].toLowerCase()} insurance`;

// What to add for a gap: demo advice (spec step 98), only for people in demo advice mode.
export const gapAdvice = (gap: Pick<Gap, "key">) => GAP_ADVICE[gap.key];

// Spec step 149: health, disability, umbrella, pet and travel cover, read from the accounts.
// Device protection is never a gap: it's for the person to choose (and cards often include
// it, spec step 152).
function moreGaps(household: Household, policies: Policy[]): Gap[] {
  const gaps: Gap[] = [];
  const { signals, pets } = household;
  const gap = (key: GapKey, kind: PolicyKind, title: string, why: string): Gap => ({
    key,
    kind,
    policyId: null,
    title,
    why,
  });
  // Only with bank data to go on: without it, there's nothing to say.
  if (signals.medicalCents !== null && !has(policies, "health")) {
    gaps.push(
      gap(
        "health",
        "health",
        "No health insurance on file",
        "There's no health plan on your profile. A hospital stay can cost tens of thousands of dollars. If you're covered through work or a partner, add it so I can keep track of it.",
      ),
    );
  }
  if (signals.paycheck && !has(policies, "disability")) {
    gaps.push(
      gap(
        "disability",
        "disability",
        "No disability insurance on file",
        "You get a paycheck, and nothing on file would replace it if an illness or injury kept you from working for months. Jobs often include it: add it if yours does.",
      ),
    );
  }
  if (
    signals.assetsCents !== null &&
    signals.assetsCents >= UMBRELLA_ASSETS_CENTS &&
    !has(policies, "umbrella")
  ) {
    gaps.push(
      gap(
        "umbrella",
        "umbrella",
        "No umbrella insurance on file",
        `What you have is worth about ${formatCents(signals.assetsCents)} by your balances and values. If someone sued you for more than your car or home liability limits, the rest could come from it. An umbrella policy pays above those limits.`,
      ),
    );
  }
  if ((pets.value ?? 0) > 0 && !has(policies, "pet")) {
    gaps.push(
      gap(
        "pet",
        "pet",
        "No pet insurance on file",
        `You told me you have ${pets.value === 1 ? "a pet" : `${pets.value} pets`}, and there's no pet insurance on file. An emergency at the vet can cost thousands.`,
      ),
    );
  }
  if (signals.travelCents >= TRAVEL_GAP_MIN_CENTS && !has(policies, "travel")) {
    gaps.push(
      gap(
        "travel",
        "travel",
        "No travel insurance for your trip",
        `You've spent ${formatCents(signals.travelCents)} on flights and hotels lately, and there's no travel insurance on file. If the trip is cancelled, the non-refundable part is lost. Your card may already cover some of it.`,
      ),
    );
  }
  return gaps;
}
