import type { PrismaClient } from "@/generated/prisma/client";
import { loadDetectionInput } from "@/detection/engine";
import { buildStreams } from "@/detection/streams";
import type { DetectionInput } from "@/detection/types";
import { policiesFromStreams } from "@/insights/found-policies";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { PolicyError, removePolicy } from "@/lib/insurance/policies";

// Insurance found from payments (spec step 99). Jane adds every insurer the person pays
// regularly to their insurance profile on its own, at every autopilot level, as "found from
// your payments": it doesn't count as cover (gaps, reshops) until they tap Confirm, and its
// renewal date is an estimate. Not insurance takes it off for good. An insurer that already
// has a policy of any kind or status (typed, from a document, the demo's, removed) is
// never added again.

type Options = { client?: PrismaClient; now?: Date };

export async function policiesFromPayments(
  userId: string,
  { client = defaultClient, now = new Date(), input }: Options & { input?: DetectionInput } = {},
): Promise<number> {
  const loaded = input ?? (await loadDetectionInput(userId, { client, now }));
  const found = policiesFromStreams(loaded, buildStreams(loaded));
  if (found.length === 0) return 0;
  const db = scopedFor(userId, client);
  const known = await db.insurancePolicies.findMany({
    where: { merchantKey: { in: found.map((f) => f.merchantKey) } },
    select: { merchantKey: true },
  });
  const has = new Set(known.map((k) => k.merchantKey));
  const fresh = found.filter((f) => !has.has(f.merchantKey));
  for (const f of fresh) {
    await db.insurancePolicies.create({
      data: {
        userId,
        kind: f.kind,
        carrier: f.carrier,
        source: "payments",
        status: "found",
        premiumCents: f.premiumCents,
        premiumFrequency: f.premiumFrequency,
        renewalDate: new Date(`${f.renewalDate}T00:00:00Z`),
        termMonths: f.termMonths,
        merchantKey: f.merchantKey,
      },
    });
  }
  if (fresh.length > 0) {
    await track(userId, "insurance_policy_added", { source: "payments", count: fresh.length });
  }
  return fresh.length;
}

// Confirm: a found policy becomes the person's cover.
export async function confirmFoundPolicy(
  userId: string,
  policyId: string,
  { client = defaultClient }: Options = {},
): Promise<{ kind: string; carrier: string }> {
  const db = scopedFor(userId, client);
  const policy = await db.insurancePolicies.findFirst({
    where: { id: policyId, status: "found" },
    select: { id: true, kind: true, carrier: true },
  });
  if (!policy) throw new PolicyError("That one's already confirmed or gone.");
  await db.insurancePolicies.updateMany({
    where: { id: policyId, status: "found" },
    data: { status: "active" },
  });
  await logAudit(
    { type: "user", id: userId },
    "insurance_policy_saved",
    { type: "insurance_policy", id: policyId },
    { kind: policy.kind, via: "found_confirmed" },
  );
  await track(userId, "insurance_policy_confirmed", { kind: policy.kind });
  return { kind: policy.kind, carrier: policy.carrier };
}

// Not insurance: off the profile, kept as removed so it's never found again.
export async function dismissFoundPolicy(
  userId: string,
  policyId: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const found = await scopedFor(userId, client).insurancePolicies.count({
    where: { id: policyId, status: "found" },
  });
  if (found === 0) throw new PolicyError("That one's already confirmed or gone.");
  await removePolicy(userId, policyId, { client });
}
