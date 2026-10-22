import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { loadProfileInput } from "@/lib/profile";
import { readHealthTaxes, type HealthTaxes } from "@/planning/health-taxes-read";
import { buildProfile, type ProfileInput } from "@/profile/build";

// The tax side of health insurance (spec step 269) for a signed-in person: their profile and
// rows read the same way the detectors read them. A Marketplace credit checked against their
// real income (a mid-year rise caught before it becomes a bill), HSA deposits against the
// limit, and medical costs against the 7.5% floor. Facts for everyone; what to do about them is
// demo advice.

type Options = { client?: PrismaClient; now?: Date };

export type HealthTaxView = HealthTaxes & { advice: boolean };

export async function loadHealthTaxes(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & { loaded?: { advice: boolean; input?: ProfileInput } } = {},
): Promise<HealthTaxView> {
  const [input, advice] = await Promise.all([
    loaded?.input ? Promise.resolve(loaded.input) : loadProfileInput(userId, { client, now }),
    loaded ? Promise.resolve(loaded.advice) : adviceMode(userId, { client }),
  ]);
  return { ...readHealthTaxes(buildProfile(input), input), advice };
}
