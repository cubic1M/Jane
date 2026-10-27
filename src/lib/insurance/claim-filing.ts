import { SMALL_CLAIM_MAX_CENTS, isPolicyKind } from "@/config/insurance";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents, parseMoneyToCents } from "@/lib/money";
import type { Claim } from "./claim-rules";
import { ClaimError, claimById, listClaims } from "./claims";
import { partnerFor, type InsurancePartner } from "./partner";

// Claims filed by Jane (spec step 155). A small claim on a policy the insurance partner
// covers can be filed through it, from the claims helper's tracker (step 107): the person
// says how much and what happened, Jane writes the claim up as a draft, and only their tap
// on the draft files it. The carrier's status is then checked daily and said in the chat.

type Options = { client?: PrismaClient; now?: Date; partner?: InsurancePartner | null };

const MAX_DESCRIPTION = 500;

// Whether Jane can file this claim itself: open, on a policy, not filed yet, and a partner.
export async function canFile(
  userId: string,
  claim: Pick<Claim, "status" | "policyId" | "filing">,
  { client = defaultClient, partner }: Options = {},
): Promise<boolean> {
  if (claim.status !== "open" || !claim.policyId || claim.filing === "filed") return false;
  const filing = partner === undefined ? await partnerFor(userId, { client }) : partner;
  return filing !== null;
}

// The draft: what Jane would send. Nothing goes to the carrier yet.
export async function draftClaim(
  userId: string,
  claimId: string,
  input: { amount: string; description: string },
  { client = defaultClient, partner }: Options = {},
): Promise<Claim> {
  const claim = await claimById(userId, claimId, { client });
  if (!claim || !(await canFile(userId, claim, { client, partner }))) {
    throw new ClaimError("Jane can't file this claim. Use the steps on the tracker.");
  }
  const amountCents = parseMoneyToCents(input.amount);
  if (amountCents === null || amountCents <= 0)
    throw new ClaimError("Enter the amount in dollars.");
  if (amountCents > SMALL_CLAIM_MAX_CENTS) {
    throw new ClaimError(
      `Jane files claims up to ${formatCents(SMALL_CLAIM_MAX_CENTS)}. For this one, call your insurer: the steps are on the tracker.`,
    );
  }
  const description = input.description.replace(/\s+/g, " ").trim();
  if (description.length < 10 || description.length > MAX_DESCRIPTION) {
    throw new ClaimError(
      `Say what happened in a sentence or two (up to ${MAX_DESCRIPTION} characters).`,
    );
  }
  await scopedFor(userId, client).insuranceClaims.updateMany({
    where: { id: claimId, status: "open", OR: [{ filing: null }, { filing: "draft" }] },
    data: { amountCents, description, filing: "draft" },
  });
  await track(userId, "insurance_claim_drafted", { kind: claim.kind });
  return (await claimById(userId, claimId, { client }))!;
}

// File it (the person's tap on the draft they've seen).
export async function fileClaim(
  userId: string,
  claimId: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<Claim> {
  const claim = await claimById(userId, claimId, { client });
  if (!claim || claim.status !== "open" || claim.filing !== "draft") {
    throw new ClaimError("There's no claim waiting for you to file.");
  }
  const filing = partner === undefined ? await partnerFor(userId, { client }) : partner;
  if (!filing || !claim.carrier || !isPolicyKind(claim.kind)) {
    throw new ClaimError("Filing isn't available right now.");
  }
  const { claimNumber } = await filing.fileClaim(
    {
      carrier: claim.carrier,
      kind: claim.kind,
      event: claim.event,
      happenedOn: claim.happenedOn,
      amountCents: claim.amountCents!,
      description: claim.description!,
    },
    { now },
  );
  const steps = claim.steps.map((s) =>
    s.key === "file" && !s.doneAt ? { ...s, doneAt: now.toISOString() } : s,
  );
  const { count } = await scopedFor(userId, client).insuranceClaims.updateMany({
    where: { id: claimId, filing: "draft" },
    data: {
      filing: "filed",
      filedAt: now,
      claimNumber,
      carrierStatus: "received",
      steps,
    },
  });
  if (count === 0) throw new ClaimError("There's no claim waiting for you to file.");
  // The file went to the carrier: record that, never what it said.
  await logAudit(
    { type: "user", id: userId },
    "insurance_claim_filed",
    { type: "insurance_claim", id: claimId },
    { kind: claim.kind, amount_cents: claim.amountCents ?? null },
  );
  await track(userId, "insurance_claim_filed", { kind: claim.kind });
  return (await claimById(userId, claimId, { client }))!;
}

// The carrier's status on each filed claim; a paid claim is closed. Returns claims that moved.
export async function refreshClaimStatuses(
  userId: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<Claim[]> {
  const filed = (await listClaims(userId, { client })).filter(
    (c) => c.filing === "filed" && c.status === "open" && c.claimNumber && c.filedAt,
  );
  if (filed.length === 0) return [];
  const checking = partner === undefined ? await partnerFor(userId, { client }) : partner;
  if (!checking) return [];
  const db = scopedFor(userId, client);
  const moved: Claim[] = [];
  for (const claim of filed) {
    const policy = claim.policyId
      ? await db.insurancePolicies.findFirst({
          where: { id: claim.policyId },
          select: { deductibleCents: true },
        })
      : null;
    const status = await checking.claimStatus(
      {
        claimNumber: claim.claimNumber!,
        filedAt: claim.filedAt!,
        amountCents: claim.amountCents ?? 0,
        deductibleCents: policy?.deductibleCents ?? null,
      },
      { now },
    );
    if (status.status === claim.carrierStatus) continue;
    await db.insuranceClaims.updateMany({
      where: { id: claim.id },
      data: {
        carrierStatus: status.status,
        payoutCents: status.payoutCents,
        ...(status.status === "paid" ? { status: "closed", closedAt: now } : {}),
      },
    });
    moved.push({ ...claim, carrierStatus: status.status, payoutCents: status.payoutCents });
  }
  return moved;
}
