import { BENEFICIARY_SUBTYPES } from "@/config/family-file";
import {
  DEMO_BENEFICIARIES_MISSING,
  DEMO_BENEFICIARY,
  DEMO_VALUES_EXCLUDES,
} from "@/data-sources/demo/people-extras/investing";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { demoPersonFor } from "./demo";

// What a sample person has told Jane about investing (spec steps 236 and 237): their values list
// and who is named on their retirement accounts. Seeded once, after the first sync has saved the
// accounts, from the same lists the detector harness reads (people-extras/investing.ts), so the
// suggestions a sample person gets in the app are the ones their written life says. The original
// demo bank, and anything the person has already set, are left as they are.
export async function ensureDemoInvestingFacts(
  userId: string,
  itemId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<void> {
  const person = await demoPersonFor(userId, { client });
  if (!person) return;
  const excludes = DEMO_VALUES_EXCLUDES[person];
  if (excludes && excludes.length > 0) {
    // One row a person: what they've already set stays.
    await client.valuesPreference.upsert({
      where: { userId },
      create: { userId, excludes: [...excludes] },
      update: {},
    });
  }
  if (DEMO_BENEFICIARIES_MISSING.includes(person)) return;
  const db = scopedFor(userId, client);
  if ((await db.accountBeneficiaries.count()) > 0) return;
  const accounts = await db.accounts.findMany({
    where: { itemId, subtype: { in: [...BENEFICIARY_SUBTYPES] } },
    select: { id: true },
  });
  if (accounts.length === 0) return;
  const confirmedOn = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  await client.accountBeneficiary.createMany({
    data: accounts.map((a) => ({
      userId,
      accountId: a.id,
      name: DEMO_BENEFICIARY.name,
      relationship: DEMO_BENEFICIARY.relationship,
      sharePct: 100,
      confirmedOn,
    })),
  });
}
