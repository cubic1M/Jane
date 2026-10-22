import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { loadProfileInput } from "@/lib/profile";
import { readRetirementTaxes, type RetirementTaxes } from "@/planning/retirement-taxes-read";
import { buildProfile } from "@/profile/build";

// Taxes on retirement income (spec step 271) for a signed-in person, read the way the detectors
// read them: how much of their Social Security is taxable and what nothing withholds, Medicare's
// surcharge line two years ahead, and the order to draw from accounts tuned to stay under it
// (handed to the investing side's retirement paycheck). Facts for everyone; the tuned order is
// demo advice.

type Options = { client?: PrismaClient; now?: Date };

export type RetirementTaxView = RetirementTaxes & { advice: boolean };

export async function loadRetirementTaxes(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & { loaded?: { advice: boolean } } = {},
): Promise<RetirementTaxView> {
  const [input, advice] = await Promise.all([
    loadProfileInput(userId, { client, now }),
    loaded ? Promise.resolve(loaded.advice) : adviceMode(userId, { client }),
  ]);
  return { ...readRetirementTaxes(buildProfile(input), input), advice };
}
