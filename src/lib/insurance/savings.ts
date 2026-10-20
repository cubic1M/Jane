import { PREMIUM_FREQUENCIES, type PremiumFrequency } from "@/config/documents";
import { SAVING_RATES, type SavingKind } from "@/config/insurance";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { partnerFor, type InsurancePartner } from "./partner";
import { listPolicies, type Policy } from "./policies";
import { findSavings, type SavingCandidate, type SavingPolicy } from "./saving-rules";

// Paying less for the same cover (spec step 196). Jane finds the cheaper ways to pay for the
// cover the person keeps (pay in full, autopay, paperless, one carrier for car and home, a
// safe-driver program, a higher deductible), shows each with its yearly figure and what
// changes, and applies it through the insurance partner on their tap. Only with a partner
// to apply it; a higher deductible says it lowers the cover.

type Options = { client?: PrismaClient; now?: Date; partner?: InsurancePartner | null };

export class SavingError extends Error {}

export type Saving = SavingCandidate & {
  id: string;
  status: "offered" | "applied" | "dismissed";
  confirmation: string | null;
};

const SELECT = {
  id: true,
  policyId: true,
  kind: true,
  status: true,
  yearlySavingCents: true,
  currentYearlyCents: true,
  newYearlyCents: true,
  detail: true,
  confirmation: true,
} as const;

function toSaving(row: Prisma.InsuranceSavingGetPayload<{ select: typeof SELECT }>): Saving {
  return {
    ...row,
    kind: row.kind as SavingKind,
    status: row.status as Saving["status"],
    detail: (row.detail ?? {}) as Saving["detail"],
  };
}

const toRule = (p: Policy): SavingPolicy => p;

// What the person has in the bank to pay a year at once or cover a higher deductible.
async function cashOf(userId: string, client: PrismaClient): Promise<number> {
  const accounts = await scopedFor(userId, client).accounts.findMany({
    where: { type: "depository" },
    select: { currentBalanceCents: true },
  });
  return accounts.reduce((sum, a) => sum + Math.max(0, a.currentBalanceCents ?? 0), 0);
}

export async function listSavings(
  userId: string,
  { client = defaultClient, status }: Options & { status?: Saving["status"] } = {},
): Promise<Saving[]> {
  const rows = await scopedFor(userId, client).insuranceSavings.findMany({
    where: status ? { status } : {},
    select: SELECT,
    orderBy: [{ yearlySavingCents: "desc" }, { id: "asc" }],
  });
  return rows.map(toSaving);
}

// Finds what applies now and keeps it: new offers added, current ones refreshed, ones that
// no longer apply removed. Applied and dismissed ones are never offered again.
export async function refreshSavings(
  userId: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<Saving[]> {
  const applying = partner === undefined ? await partnerFor(userId, { client }) : partner;
  const db = scopedFor(userId, client);
  // Recommending a cheaper way to pay is advice: demo advice mode only (spec step 98).
  if (!applying || !(await adviceMode(userId, { client }))) return [];
  const [policies, cash, known] = await Promise.all([
    listPolicies(userId, { client }),
    cashOf(userId, client),
    db.insuranceSavings.findMany({
      select: { id: true, policyId: true, kind: true, status: true },
    }),
  ]);
  const answered = new Set(
    known.filter((k) => k.status !== "offered").map((k) => `${k.policyId}:${k.kind}`),
  );
  const active = policies.filter((p) => p.status === "active").map(toRule);
  const found = findSavings(active, cash, answered);
  const offered = new Map(
    known.filter((k) => k.status === "offered").map((k) => [`${k.policyId}:${k.kind}`, k.id]),
  );
  for (const c of found) {
    const data = {
      yearlySavingCents: c.yearlySavingCents,
      currentYearlyCents: c.currentYearlyCents,
      newYearlyCents: c.newYearlyCents,
      detail: c.detail as Prisma.InputJsonObject,
    };
    const id = offered.get(`${c.policyId}:${c.kind}`);
    if (id) await db.insuranceSavings.updateMany({ where: { id }, data });
    else {
      await db.insuranceSavings.create({
        data: { userId, policyId: c.policyId, kind: c.kind, createdAt: now, ...data },
      });
      await track(userId, "insurance_saving_found", {
        kind: c.kind,
        yearly_cents: c.yearlySavingCents,
      });
    }
  }
  const still = new Set(found.map((c) => `${c.policyId}:${c.kind}`));
  const gone = [...offered].filter(([key]) => !still.has(key)).map(([, id]) => id);
  if (gone.length > 0) await db.insuranceSavings.deleteMany({ where: { id: { in: gone } } });
  return listSavings(userId, { client, status: "offered" });
}

// Applies one saving with the carrier, on the person's tap: the policy's price (and, for
// pay in full, how often it is paid; for a higher deductible, the deductible; for a bundle,
// the carrier) changes to what the carrier confirmed.
export async function applySaving(
  userId: string,
  savingId: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<Saving> {
  const db = scopedFor(userId, client);
  const row = await db.insuranceSavings.findFirst({
    where: { id: savingId, status: "offered" },
    select: SELECT,
  });
  if (!row) throw new SavingError("That one's already been answered.");
  const applying = partner === undefined ? await partnerFor(userId, { client }) : partner;
  if (!applying) throw new SavingError("Changing a policy isn't available right now.");

  // The figures as they are today, not as they were when offered.
  const policies = (await listPolicies(userId, { client })).filter((p) => p.status === "active");
  const fresh = findSavings(policies.map(toRule), await cashOf(userId, client)).find(
    (c) => c.policyId === row.policyId && c.kind === row.kind,
  );
  if (!fresh) {
    await db.insuranceSavings.deleteMany({ where: { id: savingId } });
    throw new SavingError("That doesn't apply anymore: your policy or your cash changed.");
  }
  const policy = policies.find((p) => p.id === fresh.policyId)!;
  const kind = fresh.kind;
  const frequency: PremiumFrequency = kind === "pay_in_full" ? "yearly" : policy.premiumFrequency!;
  const perYear = PREMIUM_FREQUENCIES[frequency].perYear;
  // A bundle takes the same share off the home or renters policy too.
  const place =
    kind === "bundle" ? policies.find((p) => p.id === fresh.detail.withPolicyId) : undefined;
  const carYearly =
    kind === "bundle"
      ? Math.round(fresh.currentYearlyCents * (1 - SAVING_RATES.bundle.discountShare))
      : fresh.newYearlyCents;
  const confirmed = await applying.applySaving(
    { carrier: policy.carrier, kind: policy.kind, premiumCents: policy.premiumCents },
    {
      kind,
      newPremiumCents: Math.round(carYearly / perYear),
      newFrequency: frequency,
      newDeductibleCents: fresh.detail.toDeductibleCents ?? null,
      withCarrier: fresh.detail.withCarrier ?? null,
    },
    { now },
  );
  await db.insurancePolicies.updateMany({
    where: { id: policy.id },
    data: {
      premiumCents: confirmed.premiumCents,
      premiumFrequency: frequency,
      ...(fresh.detail.toDeductibleCents !== undefined
        ? { deductibleCents: fresh.detail.toDeductibleCents }
        : {}),
      ...(fresh.detail.withCarrier ? { carrier: fresh.detail.withCarrier } : {}),
    },
  });
  if (place && place.premiumCents !== null) {
    await db.insurancePolicies.updateMany({
      where: { id: place.id },
      data: {
        premiumCents: Math.round(place.premiumCents * (1 - SAVING_RATES.bundle.discountShare)),
      },
    });
  }
  await db.insuranceSavings.updateMany({
    where: { id: savingId, status: "offered" },
    data: {
      status: "applied",
      confirmation: confirmed.confirmation,
      answeredAt: now,
      yearlySavingCents: fresh.yearlySavingCents,
      newYearlyCents: fresh.newYearlyCents,
      detail: fresh.detail as Prisma.InputJsonObject,
    },
  });
  await logAudit(
    { type: "user", id: userId },
    "insurance_saving_applied",
    { type: "insurance_policy", id: policy.id },
    { kind, yearly_saving_cents: fresh.yearlySavingCents },
  );
  await track(userId, "insurance_saving_applied", { kind, yearly_cents: fresh.yearlySavingCents });
  return toSaving(
    await db.insuranceSavings.findFirstOrThrow({ where: { id: savingId }, select: SELECT }),
  );
}

// No thanks: not offered again.
export async function dismissSaving(
  userId: string,
  savingId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const { count } = await scopedFor(userId, client).insuranceSavings.updateMany({
    where: { id: savingId, status: "offered" },
    data: { status: "dismissed", answeredAt: now },
  });
  if (count === 0) throw new SavingError("That one's already been answered.");
  await track(userId, "insurance_saving_dismissed");
}
