import { CLAIM_GUIDES, CLAIM_REMIND_EVERY_DAYS, type ClaimGuide } from "@/config/claims";
import type { PolicyKind } from "@/config/insurance";
import { DEMO_CARRIERS } from "@/data-sources/demo/demo-carriers";
import { daysBetween } from "@/detection/units";

// The claims helper's rules (spec step 107), pure: the guide for each kind of policy, the
// next step of a claim, when a reminder is due, and the insurer's claims line.

export type ClaimStepState = { key: string; label: string; dueOn: string; doneAt: string | null };

export type Claim = {
  id: string;
  policyId: string | null;
  kind: PolicyKind;
  event: string;
  happenedOn: string;
  status: "open" | "closed";
  steps: ClaimStepState[];
  carrier: string | null;
  claimsPhone: string | null;
  claimsUrl: string | null;
  claimNumber: string | null;
  createdAt: Date;
};

export const guideFor = (kind: PolicyKind): ClaimGuide => CLAIM_GUIDES[kind];

// What happened, in the guide's words ("A car accident").
export const eventLabel = (kind: PolicyKind, event: string) =>
  guideFor(kind).events[event] ?? CLAIM_GUIDES.other.events.other;

// The insurer's claims line, from the partner's catalog when the carrier is in it (a policy
// Jane bound carries the catalog's own name). Real
// carriers' numbers aren't guessed: the person has them on their card and documents.
export function claimContact(carrier: string | null) {
  const known = carrier
    ? DEMO_CARRIERS.find((c) => c.name.toLowerCase() === carrier.trim().toLowerCase())
    : undefined;
  return known ? { phone: known.claimsPhone, url: known.claimsUrl } : { phone: null, url: null };
}

// Pure: the next step not done, or null when every step is.
export const nextStep = (claim: Pick<Claim, "steps">) =>
  claim.steps.find((s) => s.doneAt === null) ?? null;

// Pure: whether the next step is due a reminder today, and which reminder it is (one when
// it falls due, then one every CLAIM_REMIND_EVERY_DAYS days while it waits).
export function reminderDue(
  claim: Claim,
  asOf: string,
): { step: ClaimStepState; round: number } | null {
  if (claim.status !== "open") return null;
  const step = nextStep(claim);
  if (!step) return null;
  const late = daysBetween(step.dueOn, asOf);
  if (late < 0) return null;
  return { step, round: Math.floor(late / CLAIM_REMIND_EVERY_DAYS) };
}
