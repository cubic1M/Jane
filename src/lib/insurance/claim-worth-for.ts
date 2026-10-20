import type { PolicyKind } from "@/config/insurance";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { claimWorth, type ClaimWorth } from "./claim-worth";
import { listPolicies, yearlyPremium, type Policy } from "./policies";

// Claim or pay yourself? for one of the person's policies (spec step 199). The policy is the
// one named, or the car or home policy when they didn't say, so the deductible and the
// premium are theirs. The comparison is demo advice only.

type Options = { client?: PrismaClient };

export type WorthResult =
  | { found: false; why: "no_policy" }
  | { found: true; policy: Policy; worth: ClaimWorth; advice: boolean };

// Which policy a claim would be on: the named kind, else a car policy, else a home or renters
// one, else the only active policy.
export function pickPolicy(policies: Policy[], kind: PolicyKind | null): Policy | null {
  const active = policies.filter((p) => p.status === "active");
  if (kind) return active.find((p) => p.kind === kind) ?? null;
  return (
    active.find((p) => p.kind === "auto") ??
    active.find((p) => p.kind === "home" || p.kind === "renters") ??
    (active.length === 1 ? active[0] : null)
  );
}

export async function claimWorthFor(
  userId: string,
  input: {
    amountCents: number;
    kind?: PolicyKind | null;
    event?: string | null;
    policyId?: string;
  },
  { client = defaultClient }: Options = {},
): Promise<WorthResult> {
  const policies = await listPolicies(userId, { client });
  const policy = input.policyId
    ? (policies.find((p) => p.id === input.policyId && p.status === "active") ?? null)
    : pickPolicy(policies, input.kind ?? null);
  if (!policy) return { found: false, why: "no_policy" };
  const worth = claimWorth({
    kind: policy.kind,
    event: input.event,
    estimateCents: input.amountCents,
    deductibleCents: policy.deductibleCents,
    yearlyPremiumCents: yearlyPremium(policy),
  });
  return { found: true, policy, worth, advice: await adviceMode(userId, { client }) };
}
