import {
  RISK_LOOKBACK_DAYS,
  RISK_NEW_PET_QUIET_DAYS,
  type PolicyKind,
  type RiskKind,
} from "@/config/insurance";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadHousehold } from "./household";
import { partnerFor, type InsurancePartner } from "./partner";
import { detectSignals } from "./risk-signals";

// Risks seen in how they live (spec step 197). Rules read the transactions (risk-signals.ts);
// each kind of signal becomes ONE question in the chat, asked once: "Are you driving for
// Uber?". Yes opens a gap with sample quotes (or adds the pet, for a new dog); a no is
// remembered and never asked again. Nothing here changes a policy.

type Options = { client?: PrismaClient; now?: Date; partner?: InsurancePartner | null };

export class RiskError extends Error {}

export type Risk = {
  id: string;
  kind: RiskKind;
  status: "asked" | "yes" | "no";
  merchant: string;
  amountCents: number;
  seenOn: string;
};

const SELECT = {
  id: true,
  kind: true,
  status: true,
  merchant: true,
  amountCents: true,
  seenOn: true,
} as const;

const day = (date: Date) => date.toISOString().slice(0, 10);

function toRisk(row: Prisma.InsuranceRiskGetPayload<{ select: typeof SELECT }>): Risk {
  return {
    ...row,
    kind: row.kind as RiskKind,
    status: row.status as Risk["status"],
    seenOn: day(row.seenOn),
  };
}

export async function listRisks(
  userId: string,
  { client = defaultClient, status }: Options & { status?: Risk["status"] } = {},
): Promise<Risk[]> {
  const rows = await scopedFor(userId, client).insuranceRisks.findMany({
    where: status ? { status } : {},
    select: SELECT,
    orderBy: [{ seenOn: "desc" }, { id: "asc" }],
  });
  return rows.map(toRisk);
}

// Reads the recent transactions and adds a question for each kind of signal not asked yet.
// Returns the new ones.
export async function refreshRisks(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Risk[]> {
  const db = scopedFor(userId, client);
  const lookback = RISK_LOOKBACK_DAYS + RISK_NEW_PET_QUIET_DAYS;
  const [rows, household, known] = await Promise.all([
    db.transactions.findMany({
      where: {
        pending: false,
        date: { gte: new Date(now.getTime() - lookback * 86_400_000), lte: now },
      },
      select: { id: true, date: true, amountCents: true, description: true, merchantName: true },
    }),
    loadHousehold(userId, { client, now }),
    db.insuranceRisks.findMany({ select: { kind: true } }),
  ]);
  const asked = new Set(known.map((k) => k.kind));
  const signals = detectSignals(
    rows.map((t) => ({ ...t, date: day(t.date) })),
    day(now),
    { knownPets: household.pets.value ?? 0 },
  ).filter((s) => !asked.has(s.kind));
  const made: Risk[] = [];
  for (const s of signals) {
    const row = await db.insuranceRisks
      .create({
        data: {
          userId,
          kind: s.kind,
          merchant: s.merchant,
          amountCents: s.amountCents,
          seenOn: new Date(`${s.date}T00:00:00Z`),
          createdAt: now,
        },
        select: SELECT,
      })
      .catch(() => null);
    // Two refreshes at once: the other one's kept.
    if (row) {
      made.push(toRisk(row));
      await track(userId, "insurance_risk_seen", { kind: s.kind });
    }
  }
  return made;
}

// The person's answer. A yes opens its gap (the household reads it); a new dog adds a pet.
export async function answerRisk(
  userId: string,
  id: string,
  yes: boolean,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Risk> {
  const db = scopedFor(userId, client);
  const row = await db.insuranceRisks.findFirst({ where: { id, status: "asked" }, select: SELECT });
  if (!row) throw new RiskError("That one's already been answered.");
  const { count } = await db.insuranceRisks.updateMany({
    where: { id, status: "asked" },
    data: { status: yes ? "yes" : "no", answeredAt: now },
  });
  if (count === 0) throw new RiskError("That one's already been answered.");
  if (yes && row.kind === "new_dog") {
    const profile = await db.insuranceProfiles.findFirst({ select: { pets: true } });
    const pets = (profile?.pets ?? 0) + 1;
    await db.insuranceProfiles.upsert({
      where: { userId },
      create: { userId, pets },
      update: { pets },
    });
  }
  await track(userId, "insurance_risk_answered", { kind: row.kind, yes });
  return toRisk({ ...row, status: yes ? "yes" : "no" });
}

export type GapQuote = {
  carrier: string;
  annualCents: number;
  monthlyCents: number;
  demo: boolean;
};

// Sample prices for a kind of cover the person doesn't have yet, at the stand-in's default
// cover: shown, never bought here. Empty without a partner.
export async function gapQuotes(
  userId: string,
  kind: PolicyKind,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<GapQuote[]> {
  const quoting = partner === undefined ? await partnerFor(userId, { client }) : partner;
  if (!quoting) return [];
  const [user, household] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { state: true } }),
    loadHousehold(userId, { client, now }),
  ]);
  const answers = await quoting.quote(
    {
      kind,
      state: user?.state ?? null,
      household: {
        housing: household.housing.value,
        vehicles: household.vehicles.value,
        dependants: household.dependants.value,
        pets: household.pets.value,
      },
      deductibleCents: null,
      coverage: {},
      premiumFrequency: "monthly",
      startDate: day(new Date(now.getTime() + 86_400_000)),
    },
    { now },
  );
  return answers.slice(0, 3).map((q) => ({
    carrier: q.carrier.name,
    annualCents: q.annualPremiumCents,
    monthlyCents: q.premiumCents,
    demo: q.demo,
  }));
}

export { RISK_GAP_KINDS } from "./risk-signals";
