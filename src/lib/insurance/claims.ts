import { MAX_CLAIM_NUMBER_LENGTH } from "@/config/claims";
import { isPolicyKind } from "@/config/insurance";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import {
  claimContact,
  guideFor,
  type CarrierClaimStatus,
  type Claim,
  type ClaimStepState,
} from "./claim-rules";

export * from "./claim-rules";

// The claims helper (spec step 107): what to do when something happens, for each kind of
// policy, and a tracker for the claim's steps with reminders. Steps are copied onto the
// claim when it starts and are only ever marked done, never removed or reordered, so the
// tracker never loses one. Jane reminds; the person files.

type Options = { client?: PrismaClient; now?: Date };

export class ClaimError extends Error {}

const SELECT = {
  id: true,
  policyId: true,
  kind: true,
  event: true,
  happenedOn: true,
  status: true,
  steps: true,
  carrier: true,
  claimsPhone: true,
  claimsUrl: true,
  claimNumber: true,
  createdAt: true,
  amountCents: true,
  description: true,
  filing: true,
  filedAt: true,
  carrierStatus: true,
  payoutCents: true,
} as const;

const day = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (iso: string, days: number) =>
  day(new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000));

function toClaim(row: Prisma.InsuranceClaimGetPayload<{ select: typeof SELECT }>): Claim {
  return {
    id: row.id,
    policyId: row.policyId,
    kind: isPolicyKind(row.kind) ? row.kind : "other",
    event: row.event,
    happenedOn: day(row.happenedOn),
    status: row.status === "closed" ? "closed" : "open",
    steps: (Array.isArray(row.steps) ? row.steps : []) as unknown as ClaimStepState[],
    carrier: row.carrier,
    claimsPhone: row.claimsPhone,
    claimsUrl: row.claimsUrl,
    claimNumber: row.claimNumber,
    createdAt: row.createdAt,
    amountCents: row.amountCents,
    description: row.description,
    filing: row.filing === "draft" || row.filing === "filed" ? row.filing : null,
    filedAt: row.filedAt,
    carrierStatus: (row.carrierStatus as CarrierClaimStatus | null) ?? null,
    payoutCents: row.payoutCents,
  };
}

export type ClaimInput = {
  policyId: string | null;
  kind: string;
  event: string;
  // YYYY-MM-DD; today when blank.
  happenedOn: string;
};

export async function startClaim(
  userId: string,
  input: ClaimInput,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Claim> {
  const db = scopedFor(userId, client);
  const policy = input.policyId
    ? await db.insurancePolicies.findFirst({
        where: { id: input.policyId, status: { in: ["active", "pending", "found"] } },
        select: { id: true, kind: true, carrier: true },
      })
    : null;
  if (input.policyId && !policy) throw new ClaimError("That policy isn't on your insurance.");
  const kind = policy && isPolicyKind(policy.kind) ? policy.kind : input.kind;
  if (!isPolicyKind(kind)) throw new ClaimError("Pick what kind of insurance it's on.");
  const guide = guideFor(kind);
  if (!Object.hasOwn(guide.events, input.event)) throw new ClaimError("Pick what happened.");
  const happenedOn = input.happenedOn.trim() || day(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(happenedOn) || addDays(happenedOn, 0) !== happenedOn) {
    throw new ClaimError("Pick the day it happened.");
  }
  if (happenedOn > day(now)) throw new ClaimError("The day it happened can't be in the future.");
  // Steps for the police only fit a break-in, theft or an accident.
  const police = ["accident", "theft", "break_in"].includes(input.event);
  const steps: ClaimStepState[] = guide.steps
    .filter((s) => s.key !== "police" || police)
    .map((s) => ({
      key: s.key,
      label: s.label,
      dueOn: addDays(happenedOn, s.dueDays),
      doneAt: null,
    }));
  const contact = claimContact(policy?.carrier ?? null);
  const row = await db.insuranceClaims.create({
    data: {
      userId,
      policyId: policy?.id ?? null,
      kind,
      event: input.event,
      happenedOn: new Date(`${happenedOn}T00:00:00Z`),
      steps: steps as unknown as Prisma.InputJsonArray,
      carrier: policy?.carrier ?? null,
      claimsPhone: contact.phone,
      claimsUrl: contact.url,
    },
    select: SELECT,
  });
  await logAudit(
    { type: "user", id: userId },
    "insurance_claim_started",
    {
      type: "insurance_claim",
      id: row.id,
    },
    { kind, event: input.event },
  );
  await track(userId, "insurance_claim_started", { kind, event: input.event });
  return toClaim(row);
}

async function openClaim(userId: string, claimId: string, client: PrismaClient) {
  const row = await scopedFor(userId, client).insuranceClaims.findFirst({
    where: { id: claimId, status: "open" },
    select: SELECT,
  });
  if (!row) throw new ClaimError("That claim isn't open anymore.");
  return toClaim(row);
}

// Marks one step done. Doing it twice changes nothing; a step is never taken off.
export async function markStepDone(
  userId: string,
  claimId: string,
  stepKey: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ claim: Claim; changed: boolean }> {
  const claim = await openClaim(userId, claimId, client);
  const step = claim.steps.find((s) => s.key === stepKey);
  if (!step) throw new ClaimError("That step isn't on this claim.");
  if (step.doneAt) return { claim, changed: false };
  const steps = claim.steps.map((s) =>
    s.key === stepKey ? { ...s, doneAt: now.toISOString() } : s,
  );
  await scopedFor(userId, client).insuranceClaims.updateMany({
    where: { id: claimId, status: "open" },
    data: { steps: steps as unknown as Prisma.InputJsonArray },
  });
  await track(userId, "insurance_claim_step_done", { kind: claim.kind, step: stepKey });
  return { claim: { ...claim, steps }, changed: true };
}

export async function saveClaimNumber(
  userId: string,
  claimId: string,
  claimNumber: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const text = claimNumber.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_CLAIM_NUMBER_LENGTH) {
    throw new ClaimError("Enter the claim number your insurer gave you.");
  }
  await openClaim(userId, claimId, client);
  await scopedFor(userId, client).insuranceClaims.updateMany({
    where: { id: claimId },
    data: { claimNumber: text },
  });
}

export async function closeClaim(
  userId: string,
  claimId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const claim = await openClaim(userId, claimId, client);
  await scopedFor(userId, client).insuranceClaims.updateMany({
    where: { id: claimId, status: "open" },
    data: { status: "closed", closedAt: now },
  });
  await track(userId, "insurance_claim_closed", {
    kind: claim.kind,
    steps_done: claim.steps.filter((s) => s.doneAt).length,
  });
}

export async function listClaims(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<Claim[]> {
  const rows = await scopedFor(userId, client).insuranceClaims.findMany({
    select: SELECT,
    orderBy: [{ status: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toClaim);
}

export async function claimById(
  userId: string,
  claimId: string,
  { client = defaultClient }: Options = {},
): Promise<Claim | null> {
  const row = await scopedFor(userId, client).insuranceClaims.findFirst({
    where: { id: claimId },
    select: SELECT,
  });
  return row ? toClaim(row) : null;
}
