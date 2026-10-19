import type { PrismaClient } from "@/generated/prisma/client";
import { loadTaxProfile } from "@/lib/tax-profile";
import type { TaxProfileView } from "@/planning/tax-profile";

// What Jane's brain looks at for taxes (spec steps 118–127), loaded with the same code as
// /taxes. Optional on the snapshot, so a test's snapshot can leave it out.

export type TaxSnapshot = {
  tax?: { profile: TaxProfileView } | null;
};

export async function loadTaxSnapshot(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<TaxSnapshot> {
  return { tax: { profile: await loadTaxProfile(userId, { client, now }) } };
}
