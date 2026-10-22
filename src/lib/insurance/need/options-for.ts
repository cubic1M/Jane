import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { partnerFor, type InsurancePartner } from "@/lib/insurance/partner";
import { loadHousehold } from "@/lib/insurance/household";
import { yearlyPremium, type Policy } from "@/lib/insurance/policies";
import { buildOptions, optionRequests, type OptionSet, type PricedRequest } from "./options";
import type { Need, NeedPolicy } from "./types";

// Asks the quote stand-in to price the variants of a need (spec step 275) and builds the option
// set. Only for people the stand-in answers for (the demo bank); a real account gets no options,
// only the need and the gap. Nothing here buys or changes anything.

type Options = { client?: PrismaClient; now?: Date; partner?: InsurancePartner | null };

export async function optionsFor(
  userId: string,
  need: Need,
  policy: (NeedPolicy & Pick<Policy, "premiumCents" | "premiumFrequency">) | null,
  extra: {
    yearlyPayCents?: number | null;
    netWorthCents?: number | null;
    evidence?: { percent: number; reason: string };
  } = {},
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<OptionSet | null> {
  const quoting = partner === undefined ? await partnerFor(userId, { client }) : partner;
  if (!quoting) return null;
  const [user, household] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { state: true } }),
    loadHousehold(userId, { client, now }),
  ]);
  const start = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  const priced: PricedRequest[] = [];
  for (const request of optionRequests(need, policy, extra)) {
    const quotes = await quoting.quote(
      {
        kind: request.kind,
        state: user?.state ?? null,
        household: {
          housing: household.housing.value,
          vehicles: household.vehicles.value,
          dependants: household.dependants.value,
          pets: household.pets.value,
        },
        deductibleCents: request.deductibleCents,
        coverage: request.coverage,
        premiumFrequency: policy?.premiumFrequency ?? "monthly",
        startDate: start,
      },
      { now },
    );
    priced.push({ request, quotes });
  }
  const set = buildOptions(need, priced, policy ? yearlyPremium(policy) : null, {
    policyId: policy?.id ?? null,
    evidence: extra.evidence,
  });
  return set.options.length > 0 ? set : null;
}
