import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { loadProfileInput } from "@/lib/profile";
import { buildProfile } from "@/profile/build";
import { computeNeeds } from "./calculators";
import { listPolicies } from "@/lib/insurance/policies";
import { needInputFromProfile } from "./from-profile";
import { optionsFor } from "./options-for";
import type { Need } from "./types";

// The needs for one person, from the same profile the detectors read (spec step 278), so the
// chat, the page and the nightly scan all give the same number for the same person. Loads the
// profile, so it is called when a need is asked about, not on every message.

export async function withNeeds<T extends { needs?: Need[] | null }>(
  userId: string,
  snapshot: T,
  options: { client?: PrismaClient; now?: Date } = {},
): Promise<T> {
  if (snapshot.needs !== undefined) return snapshot;
  return { ...snapshot, needs: await loadNeeds(userId, options) };
}

export async function loadNeeds(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<Need[] | null> {
  const data = await loadProfileInput(userId, { client, now });
  const input = needInputFromProfile(buildProfile(data), data);
  return input ? computeNeeds(input) : null;
}

// The option set for one need, priced by the stand-in (spec step 276): re-derived on the server
// every time, so a pick is checked against what the person is shown now, not what a client sent.
export async function optionsForNeed(
  userId: string,
  topic: Need["kind"],
  {
    client = defaultClient,
    now = new Date(),
    policyId,
  }: { client?: PrismaClient; now?: Date; policyId?: string } = {},
) {
  const data = await loadProfileInput(userId, { client, now });
  const profile = buildProfile(data);
  const input = needInputFromProfile(profile, data);
  if (!input) return null;
  const need = computeNeeds(input).find(
    (n) => n.kind === topic && (!policyId || n.policyId === policyId),
  );
  if (!need) return null;
  const policy = need.policyId
    ? ((await listPolicies(userId, { client })).find((p) => p.id === need.policyId) ?? null)
    : null;
  const set = await optionsFor(
    userId,
    need,
    policy,
    { yearlyPayCents: input.yearlyPayCents, netWorthCents: input.netWorthCents },
    { client, now },
  );
  return set ? { need, set } : null;
}
