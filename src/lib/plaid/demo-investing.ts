import { BENEFICIARY_SUBTYPES } from "@/config/family-file";
import {
  DEMO_BENEFICIARIES_MISSING,
  DEMO_BENEFICIARY,
  DEMO_VALUES_EXCLUDES,
} from "@/data-sources/demo/people-extras/investing";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { DEMO_FAMILY_CREDIT, demoToldFor } from "@/data-sources/demo/people-extras/told";
import type { PersonId } from "@/config/people";
import { factSpec } from "@/profile/facts";
import { PROFILE_FACT_PREFIX } from "@/lib/profile";
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
  await ensureDemoTold(userId, person, { client, now });
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

// What a sample person told Jane that no bank shows (people-extras/told.ts): profile answers (an
// inherited IRA's year) and the loans they co-signed for family. Seeded once; anything the
// person has already answered or added stays.
async function ensureDemoTold(
  userId: string,
  person: PersonId,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<void> {
  const told = demoToldFor(person, now.toISOString().slice(0, 10));
  for (const [key, value] of Object.entries(told)) {
    const spec = factSpec(key);
    if (!spec) continue;
    await client.janePreference.upsert({
      where: { userId_kind_key: { userId, kind: "fact", key: `${PROFILE_FACT_PREFIX}${key}` } },
      create: {
        userId,
        kind: "fact",
        key: `${PROFILE_FACT_PREFIX}${key}`,
        value: { value },
        label: `${spec.label}: ${String(value)}`,
      },
      update: {},
    });
  }
  const credit = DEMO_FAMILY_CREDIT[person] ?? [];
  if (credit.length > 0 && (await scopedFor(userId, client).familyCredit.count()) === 0) {
    await client.familyCreditHelp.createMany({
      data: credit.map((c) => ({
        userId,
        kind: c.kind,
        person: c.person,
        balanceCents: c.balanceCents,
        monthlyPaymentCents: c.monthlyPaymentCents,
        missed: c.missed,
      })),
    });
  }
}
