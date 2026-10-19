import type { PrismaClient } from "@/generated/prisma/client";
import type { Gap } from "@/lib/insurance/gaps";
import type { Household } from "@/lib/insurance/household";
import { nextRenewal, type Policy } from "@/lib/insurance/policies";
import { partnerFor } from "@/lib/insurance/partner";
import { loadInsurance } from "@/lib/insurance/profile";
import { openShops, recentNoBetter, type Shop } from "@/lib/insurance/shop";
import { switchesFor } from "@/lib/insurance/switch";
import { SWITCH_NEWS_DAYS } from "@/config/insurance";

// What Jane's brain knows about the person's insurance (spec Phase X), from the same loader
// as /insurance.

export type InsuranceSnapshot = {
  policies: (Policy & { nextRenewal: string | null })[];
  gaps: Gap[];
  household: Household;
  // Demo advice mode (spec step 98).
  advice: boolean;
  // Whether an insurance partner can quote for this person (spec step 103).
  canQuote: boolean;
  // Spec step 104: Jane shops this person's policies herself (a partner and demo advice
  // mode), her open picks, and reshops that found nothing better lately.
  // Optional, so a snapshot built without them (in tests) says nothing about reshops.
  shopsItself?: boolean;
  shops?: Shop[];
  noBetter?: Shop[];
  // Spec step 105: switches Jane is doing (the new policy bound, waiting for its first
  // payment) and ones finished lately.
  switches?: Switch[];
};

export type Switch = Awaited<ReturnType<typeof switchesFor>>[number];

export async function loadInsuranceSnapshot(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<InsuranceSnapshot> {
  const asOf = now.toISOString().slice(0, 10);
  const [{ policies, gaps, household, advice }, partner, shops, noBetter, switches] =
    await Promise.all([
      loadInsurance(userId, { client, now }),
      partnerFor(userId, { client }),
      openShops(userId, { client, now }),
      recentNoBetter(userId, { client, now }),
      switchesFor(userId, {
        client,
        since: new Date(now.getTime() - SWITCH_NEWS_DAYS * 86_400_000),
      }),
    ]);
  return {
    policies: policies.map((p) => ({ ...p, nextRenewal: nextRenewal(p, asOf) })),
    gaps,
    household,
    advice,
    canQuote: partner !== null,
    shopsItself: partner !== null && advice,
    shops,
    noBetter,
    switches,
  };
}
