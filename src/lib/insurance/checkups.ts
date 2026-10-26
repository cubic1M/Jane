import { autopilotFor } from "@/lib/sector-autopilot";
import { keepCovered } from "./review";
import { CHECKUP_DAILY_LIMIT, CHECKUP_EVERY_DAYS } from "@/config/insurance";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { coverageCheckup, type Recommendation } from "./checkup";
import { loadHousehold } from "./household";
import { listPolicies } from "./policies";

// Running the coverage checkup (spec step 106): on its own once a year and after a life
// event (spec step 100), or when the person asks. Only in demo advice mode (spec step 98):
// it recommends. Each run is kept with its recommendations as they were shown.

type Options = { client?: PrismaClient; now?: Date };

// enrollment: the review before the employer's open enrollment (spec step 150).
export type CheckupReason = "yearly" | "life_event" | "asked" | "enrollment";

export type Checkup = {
  id: string;
  reason: CheckupReason;
  recommendations: Recommendation[];
  seenAt: Date | null;
  createdAt: Date;
};

const SELECT = { id: true, reason: true, recommendations: true, seenAt: true, createdAt: true };

function toCheckup(row: Prisma.InsuranceCheckupGetPayload<{ select: typeof SELECT }>): Checkup {
  return {
    id: row.id,
    reason: row.reason as CheckupReason,
    recommendations: (Array.isArray(row.recommendations)
      ? row.recommendations
      : []) as unknown as Recommendation[],
    seenAt: row.seenAt,
    createdAt: row.createdAt,
  };
}

// The person's money and things that matter for the checkup, from their accounts.
async function inputFor(
  userId: string,
  { client, now, newBaby }: { client: PrismaClient; now: Date; newBaby: boolean },
) {
  const db = scopedFor(userId, client);
  const [policies, household, savings, owned] = await Promise.all([
    listPolicies(userId, { client }),
    loadHousehold(userId, { client, now }),
    db.accounts.findMany({
      where: { type: "depository", subtype: "savings" },
      select: { currentBalanceCents: true },
    }),
    db.ownedAssets.findMany({ select: { kind: true, valueCents: true } }),
  ]);
  const balances = savings.flatMap((a) =>
    a.currentBalanceCents === null ? [] : [a.currentBalanceCents],
  );
  const homes = owned.filter((o) => o.kind === "home").map((o) => o.valueCents);
  return {
    policies,
    household,
    savingsCents: balances.length > 0 ? balances.reduce((a, b) => a + b, 0) : null,
    carValuesCents: owned.filter((o) => o.kind === "vehicle").map((o) => o.valueCents),
    homeValueCents: homes.length > 0 ? Math.max(...homes) : null,
    newBaby,
  };
}

export async function latestCheckup(
  userId: string,
  // The yearly schedule leaves out the review before open enrollment at work (spec step 150).
  { client = defaultClient, checkupsOnly = false }: Options & { checkupsOnly?: boolean } = {},
): Promise<Checkup | null> {
  const row = await scopedFor(userId, client).insuranceCheckups.findFirst({
    where: checkupsOnly ? { reason: { not: "enrollment" } } : {},
    select: SELECT,
    orderBy: { createdAt: "desc" },
  });
  return row ? toCheckup(row) : null;
}

// Runs the checkup now and keeps it. Null outside demo advice mode or with no policies.
export async function runCheckup(
  userId: string,
  reason: CheckupReason,
  {
    client = defaultClient,
    now = new Date(),
    lifeEvent = null,
  }: Options & { lifeEvent?: { id: string; kind: string } | null } = {},
): Promise<Checkup | null> {
  if (!(await adviceMode(userId, { client }))) return null;
  const input = await inputFor(userId, {
    client,
    now,
    newBaby: lifeEvent?.kind === "new_baby",
  });
  if (!input.policies.some((p) => p.status === "active")) return null;
  const recommendations = coverageCheckup(input);
  const row = await scopedFor(userId, client).insuranceCheckups.create({
    data: {
      userId,
      reason,
      lifeEventId: lifeEvent?.id ?? null,
      recommendations: recommendations as unknown as Prisma.InputJsonArray,
      createdAt: now,
    },
    select: SELECT,
  });
  await track(userId, "insurance_checkup_run", { reason, recommendations: recommendations.length });
  return toCheckup(row);
}

// Whether a checkup is due for this person today, and why: a life event since the last one,
// or a year gone by (or never run).
export async function checkupDue(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ reason: CheckupReason; lifeEvent: { id: string; kind: string } | null } | null> {
  const db = scopedFor(userId, client);
  const last = await latestCheckup(userId, { client, checkupsOnly: true });
  const event = await db.lifeEvents.findFirst({
    where: last ? { createdAt: { gt: last.createdAt } } : {},
    select: { id: true, kind: true },
    orderBy: { createdAt: "desc" },
  });
  if (event && last) return { reason: "life_event", lifeEvent: event };
  if (!last || now.getTime() - last.createdAt.getTime() >= CHECKUP_EVERY_DAYS * 86_400_000) {
    return { reason: event ? "life_event" : "yearly", lifeEvent: event };
  }
  return null;
}

export async function checkupPerson(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Checkup | null> {
  const due = await checkupDue(userId, { client, now });
  if (!due) return null;
  const checkup = await runCheckup(userId, due.reason, { client, now, lifeEvent: due.lifeEvent });
  // Spec step 202: at "Everything allowed" the review does the same-cover work by itself,
  // within the caps, before it says what it did.
  if (checkup && (await autopilotFor(userId, "insurance", { client, now })).level === "all") {
    await keepCovered(userId, { client, now, by: "autopilot" });
  }
  return checkup;
}

// The daily run: everyone with an active policy, checked where due.
export async function checkupAll({
  client = defaultClient,
  now = new Date(),
}: Options = {}): Promise<{ people: number; checkups: number }> {
  // A system job across users: ids only; everything after is scoped to the person.
  const people = await client.insurancePolicy.findMany({
    where: { status: "active" },
    select: { userId: true },
    distinct: ["userId"],
    orderBy: { userId: "asc" },
    take: CHECKUP_DAILY_LIMIT,
  });
  let checkups = 0;
  for (const { userId } of people) {
    try {
      if (await checkupPerson(userId, { client, now })) checkups += 1;
    } catch (error) {
      console.error("Insurance checkup failed", { userId, error: String(error) });
    }
  }
  return { people: people.length, checkups };
}

// "Got it" in the chat, or opening the checkup page. False when already seen.
export async function markCheckupSeen(
  userId: string,
  checkupId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const { count } = await scopedFor(userId, client).insuranceCheckups.updateMany({
    where: { id: checkupId, seenAt: null },
    data: { seenAt: now },
  });
  return count > 0;
}
