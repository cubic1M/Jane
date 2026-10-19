import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// The person's insurance for their data download (src/lib/data-export.ts): every policy,
// including cancelled and removed ones, and the household facts they typed.
export async function insuranceExport(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
) {
  const db = scopedFor(userId, client);
  const [policies, household] = await Promise.all([
    db.insurancePolicies.findMany({
      select: {
        kind: true,
        carrier: true,
        status: true,
        source: true,
        premiumCents: true,
        premiumFrequency: true,
        deductibleCents: true,
        coverage: true,
        covers: true,
        renewalDate: true,
        termMonths: true,
        documentId: true,
        cancelledAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    db.insuranceProfiles.findFirst({
      select: { housing: true, vehicles: true, dependants: true, pets: true, dismissedGaps: true },
    }),
  ]);
  return { policies, household };
}
