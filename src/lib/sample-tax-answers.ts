import { DEMO_PAY_STUB, type FilingStatus } from "@/config/tax";
import type { PersonId } from "@/config/people";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// A sample person's tax profile answers, as if they had answered them (like their goals and
// investor profile): how they file and who they claim, and for the Reyes the family details
// the childcare comparison needs. Without them the family's estimate counted no children
// while they pay $16,500 a year in childcare (area plan walk). Sample data only: never for a
// real account, and no audit or analytics event, since nobody answered.

type Answers = {
  filingStatus: FilingStatus;
  childrenUnder17: number;
  otherDependants: number;
  family?: {
    children: { ageAtYearEnd: number; hasSsn: boolean; monthsLivedWithYou: number }[];
    // The spouse's take-home a year in the sample bank (their paychecks), grossed up the way
    // the demo pay stub is (src/lib/payroll/demo.ts).
    spouseNetCents: number;
  };
};

export const SAMPLE_TAX_ANSWERS: Readonly<Record<PersonId, Answers>> = {
  renter: { filingStatus: "single", childrenUnder17: 0, otherDependants: 0 },
  // Two kids in childcare; the spouse is paid $2,480 twice a month by Springfield Schools.
  family: {
    filingStatus: "married_joint",
    childrenUnder17: 2,
    otherDependants: 0,
    family: {
      children: [
        { ageAtYearEnd: 4, hasSsn: true, monthsLivedWithYou: 12 },
        { ageAtYearEnd: 7, hasSsn: true, monthsLivedWithYou: 12 },
      ],
      spouseNetCents: 248_000 * 24,
    },
  },
  freelancer: { filingStatus: "single", childrenUnder17: 0, otherDependants: 0 },
  equity: { filingStatus: "single", childrenUnder17: 0, otherDependants: 0 },
  preretire: { filingStatus: "married_joint", childrenUnder17: 0, otherDependants: 0 },
  retiree: { filingStatus: "single", childrenUnder17: 0, otherDependants: 0 },
  debt: { filingStatus: "single", childrenUnder17: 0, otherDependants: 0 },
  owner: { filingStatus: "single", childrenUnder17: 0, otherDependants: 0 },
};

export async function seedSampleTaxAnswers(
  userId: string,
  person: PersonId,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<void> {
  const answers = SAMPLE_TAX_ANSWERS[person];
  const db = scopedFor(userId, client);
  if (await db.taxProfiles.count()) return;
  const family = answers.family;
  await db.taxProfiles.create({
    data: {
      userId,
      filingStatus: answers.filingStatus,
      childrenUnder17: answers.childrenUnder17,
      otherDependants: answers.otherDependants,
      answered: ["filingStatus", "dependants"],
      ...(family
        ? {
            familyChildren: family.children,
            spouseWagesCents: Math.round(
              (family.spouseNetCents * DEMO_PAY_STUB.grossCents) / DEMO_PAY_STUB.netCents,
            ),
            paysOverHalfHome: true,
          }
        : {}),
    },
  });
}
