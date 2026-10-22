import type { PrismaClient } from "@/generated/prisma/client";
import { DETECTORS, runDetectors } from "@/detectors";
import { db as defaultClient } from "@/lib/db";
import { loadProfileInput } from "@/lib/profile";
import { taxFound, type TaxFound } from "@/planning/tax-scan";
import { buildProfile } from "@/profile/build";

// Taxes on autopilot, round three (spec step 273): every tax detector's suggestion for the
// person, from the same scan as everything else (src/detectors), ranked with the rest and placed
// on the year's tax calendar.

type Options = { client?: PrismaClient; now?: Date };

export async function loadTaxFound(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<TaxFound[]> {
  const input = await loadProfileInput(userId, { client, now });
  const fired = runDetectors({ profile: buildProfile(input), data: input }, DETECTORS);
  return taxFound(fired, Number(input.today.slice(5, 7)));
}
