import type { PolicyKind } from "@/config/insurance";
import type { PrismaClient } from "@/generated/prisma/client";
import { claimContact } from "@/lib/insurance/claim-rules";
import { kindWords } from "@/lib/insurance/gaps";
import type { Reply } from "../replies";
import type { MessageAction } from "../types";
import { guideBody } from "./claim-words";
import type { InsuranceIntent } from "./intents";
import { loadInsuranceSnapshot } from "./snapshot";

// "I had an accident", "someone broke in" (spec step 107): the claims guide for the policy
// it's on, with "Start a claim tracker". Works for every kind of policy, and without one.

const CLAIMS_PAGE: MessageAction = {
  id: "open",
  label: "Your claims",
  kind: "link",
  href: "/insurance/claims",
};

export async function claimAnswer(
  userId: string,
  intent: InsuranceIntent,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  const { policies, household } = await loadInsuranceSnapshot(userId, { client, now });
  const active = policies.filter((p) => p.status === "active" || p.status === "pending");
  // Home events go on a home or a renters policy, whichever they have.
  const fits = (kind: PolicyKind) =>
    intent.policyKind === "home"
      ? kind === "home" || kind === "renters"
      : kind === intent.policyKind;
  const policy = intent.policyKind ? (active.find((p) => fits(p.kind)) ?? null) : null;

  if (!intent.event) {
    const choices = intent.policyKind ? active.filter((p) => fits(p.kind)) : active;
    return {
      body:
        choices.length > 0
          ? `Tell me what happened and I'll show what to do now, what to collect and who to call, and track each step. You can also start it on your claims page for one of these.\n${choices.map((p) => `- ${p.carrier} ${kindWords(p.kind)}`).join("\n")}`
          : 'Tell me what happened, like "I had a car accident" or "someone broke in", and I\'ll show what to do now, what to collect and who to call.',
      actions: [CLAIMS_PAGE],
      refs: {},
    };
  }
  const kind: PolicyKind =
    policy?.kind ??
    (intent.policyKind === "home" && household.housing.value === "rent"
      ? "renters"
      : (intent.policyKind ?? "other"));
  const event = intent.event;
  const contact = claimContact(policy?.carrier ?? null);
  return {
    body: guideBody(
      kind,
      event,
      policy ? { carrier: policy.carrier, kind: policy.kind } : null,
      contact,
    ),
    actions: [
      { id: "insurance.claim_start", label: "Start a claim tracker", kind: "primary" },
      CLAIMS_PAGE,
    ],
    refs: { claim: { kind, event, policyId: policy?.id ?? null } },
  };
}
