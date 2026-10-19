import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { checkupAll, checkupPerson } from "./checkups";
import { insuranceAutopilot } from "./autopilot";
import { reshopAll, reshopPerson } from "./shop";
import { benefitsFromPayroll } from "./benefits";
import { enrollmentReview } from "./benefits-review";
import { BENEFITS_DAILY_LIMIT } from "@/config/benefits";
import { CLAIMS_DAILY_LIMIT, LIFE_DAILY_LIMIT } from "@/config/insurance";
import { sizeLife } from "./life";
import { coverChangesAll, prepareCoverChanges } from "./cover-changes";
import { negotiationsAll, negotiationsDue } from "./negotiate";
import { refreshClaimStatuses } from "./claim-filing";

// Insurance that runs itself (spec Phase X), at every autopilot level: reshops 45 days before
// renewal and on a price rise (step 104), and the coverage checkup once a year and after a
// life event (step 106). Daily for everyone, and right after a person's bank syncs.

type Options = { client?: PrismaClient; now?: Date };

export async function insuranceDaily({ client = defaultClient, now = new Date() }: Options = {}) {
  return {
    reshop: await reshopAll({ client, now }),
    checkups: await checkupAll({ client, now }),
    benefits: await benefitsAll({ client, now }),
    life: await lifeAll({ client, now }),
    coverChanges: await coverChangesAll({ client, now }),
    negotiations: await negotiationsAll({ client, now }),
    claims: await claimStatusesAll({ client, now }),
  };
}

// Spec step 153: life cover sized, with fresh term quotes, for people in demo advice mode
// (sizeLife checks). Quotes are only asked for again when they expire or the numbers move.
export async function lifeAll({ client = defaultClient, now = new Date() }: Options = {}) {
  // A system job across users: ids only; everything after is scoped to the person.
  const people = await client.insurancePolicy.findMany({
    where: { status: "active" },
    select: { userId: true },
    distinct: ["userId"],
    take: LIFE_DAILY_LIMIT,
  });
  let sized = 0;
  for (const { userId } of people) {
    try {
      if ((await sizeLife(userId, { client, now })).kind === "sized") sized += 1;
    } catch (error) {
      console.error("Life sizing failed", { userId, error: String(error) });
    }
  }
  return { people: people.length, sized };
}

// Spec step 150: benefits through work read from the newest pay stub, and Jane's review ready
// before the employer's open enrollment, for everyone with a policy on file.
export async function benefitsAll({ client = defaultClient, now = new Date() }: Options = {}) {
  // A system job across users: ids only; everything after is scoped to the person.
  const people = await client.insurancePolicy.findMany({
    where: { status: "active" },
    select: { userId: true },
    distinct: ["userId"],
    take: BENEFITS_DAILY_LIMIT,
  });
  let found = 0;
  let reviews = 0;
  for (const { userId } of people) {
    try {
      found += await benefitsFromPayroll(userId, { client, now });
      if (await enrollmentReview(userId, { client, now })) reviews += 1;
    } catch (error) {
      console.error("Benefits run failed", { userId, error: String(error) });
    }
  }
  return { people: people.length, found, reviews };
}

// After one person's sync. A problem here never fails the sync; the daily run tries again.
export async function insuranceAfterSync(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  try {
    await reshopPerson(userId, { client, now });
    // Spec step 141: a switch within Insurance's autopilot caps, when the person allowed it.
    await insuranceAutopilot(userId, { client, now });
    await checkupPerson(userId, { client, now });
    // Spec step 150.
    await benefitsFromPayroll(userId, { client, now });
    await enrollmentReview(userId, { client, now });
    // Spec step 153.
    await sizeLife(userId, { client, now });
    // Spec step 154.
    await prepareCoverChanges(userId, { client, now });
    // Spec step 155.
    await negotiationsDue(userId, { client, now });
    await refreshClaimStatuses(userId, { client, now });
  } catch (error) {
    console.error("Insurance after sync failed", { userId, error: String(error) });
  }
}

// Spec step 155: the carrier's status on every claim Jane filed.
export async function claimStatusesAll({ client = defaultClient, now = new Date() }: Options = {}) {
  // A system job across users: ids only; everything after is scoped to the person.
  const people = await client.insuranceClaim.findMany({
    where: { filing: "filed", status: "open" },
    select: { userId: true },
    distinct: ["userId"],
    take: CLAIMS_DAILY_LIMIT,
  });
  let moved = 0;
  for (const { userId } of people) {
    try {
      moved += (await refreshClaimStatuses(userId, { client, now })).length;
    } catch (error) {
      console.error("Claim status failed", { userId, error: String(error) });
    }
  }
  return { people: people.length, moved };
}
