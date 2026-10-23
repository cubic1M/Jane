import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { detectFor } from "@/lib/suggestions";
import { taxFound, type TaxFound } from "@/planning/tax-scan";

// Taxes on autopilot, round three (spec step 273): every tax detector's suggestion for the
// person, from the same scan as everything else (src/detectors), ranked with the rest and placed
// on the year's tax calendar.

type Options = { client?: PrismaClient; now?: Date };

export async function loadTaxFound(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<TaxFound[]> {
  // What Jane may show them: no recommendations for a real account (taxes QA, 2026-10-22).
  const { suggestions, today } = await detectFor(userId, { client, now });
  return taxFound(suggestions, Number(today.slice(5, 7)));
}
