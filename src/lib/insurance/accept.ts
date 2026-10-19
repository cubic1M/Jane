import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { CARD_SELECT, buildCard } from "@/lib/cards";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { sameCompany } from "@/lib/documents/dates";
import { kindWords } from "./gaps";
import { POLICY_SELECT, toPolicy } from "./policies";
import { shopById } from "./shop";

// Yes to Jane's pick (spec step 104): the person's one tap. Recorded like every other yes:
// a decision on the policy's insurance_reshop finding (the one detection found for this
// insurer, or one made for the policy), with the pick kept in its options, and an action
// for the switch. Spec step 105's agent does the switch itself; until then the team does.

type Options = { client?: PrismaClient; now?: Date };

export class AcceptShopError extends Error {}

const DECIDABLE = ["new", "shown"] as const;

// What the decision keeps about the switch: enough for the agent (spec step 105) to bind
// the pick without the quote, which the next reshop replaces.
export type InsuranceSwitchOptions = {
  insuranceShopId: string;
  insurancePolicyId: string;
  insuranceCarrier: string;
  insuranceAnnualCents: number;
  insuranceSavingCents: number;
};

export function insuranceSwitchOf(options: unknown): InsuranceSwitchOptions | null {
  const o = (options ?? {}) as Record<string, unknown>;
  return typeof o.insuranceShopId === "string" && typeof o.insurancePolicyId === "string"
    ? (o as InsuranceSwitchOptions)
    : null;
}

export async function acceptShop(
  userId: string,
  shopId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ decisionId: string; actionId: string }> {
  const db = scopedFor(userId, client);
  const shop = await shopById(userId, shopId, { client });
  if (!shop || shop.status !== "open" || !shop.pick || shop.savingCents === null) {
    throw new AcceptShopError("This one's already been answered.");
  }
  if (shop.expiresAt && shop.expiresAt <= now) {
    throw new AcceptShopError("These quotes have expired. Ask me to shop it again.");
  }
  const policyRow = await db.insurancePolicies.findFirst({
    where: { id: shop.policyId, status: "active" },
    select: POLICY_SELECT,
  });
  if (!policyRow) throw new AcceptShopError("That policy isn't on your insurance anymore.");
  const policy = toPolicy(policyRow);

  // Detection's finding for this insurer, if it's still open; otherwise one for the policy.
  const open = await db.findings.findMany({
    where: { type: "insurance_reshop", status: { in: [...DECIDABLE] } },
    select: { id: true, evidence: true },
  });
  const matched = open.find((f) => {
    const merchant = (f.evidence as { merchant?: unknown } | null)?.merchant;
    return typeof merchant === "string" && sameCompany(policy.carrier, merchant);
  });
  const finding =
    matched ??
    (await db.findings.upsert({
      where: { userId_type_key: { userId, type: "insurance_reshop", key: `shop:${shop.id}` } },
      create: {
        userId,
        type: "insurance_reshop",
        key: `shop:${shop.id}`,
        title: `Your ${policy.carrier} ${kindWords(policy.kind)} could cost less`,
        annualSavingsCents: shop.savingCents,
        amountCents: shop.currentAnnualCents,
        confidence: "high",
        evidence: { merchant: policy.carrier, annualCostCents: shop.currentAnnualCents },
      },
      update: {},
      select: { id: true },
    }));
  const cardRow = await db.findings.findFirstOrThrow({
    where: { id: finding.id },
    select: CARD_SELECT,
  });
  const card = buildCard({ ...cardRow, annualSavingsCents: shop.savingCents });
  const options: InsuranceSwitchOptions = {
    insuranceShopId: shop.id,
    insurancePolicyId: policy.id,
    insuranceCarrier: shop.pick.carrier.name,
    insuranceAnnualCents: shop.pick.annualPremiumCents,
    insuranceSavingCents: shop.savingCents,
  };

  const result = await db.transaction(async (tx) => {
    const claimed = await tx.findings.updateMany({
      where: { id: finding.id, status: { in: [...DECIDABLE] } },
      data: { status: "approved", annualSavingsCents: shop.savingCents },
    });
    if (claimed.count === 0) throw new AcceptShopError("This one's already been answered.");
    const decision = await tx.decisions.create({
      data: {
        userId,
        findingId: finding.id,
        choice: "yes",
        cardSnapshot: card as unknown as Prisma.InputJsonObject,
        source: "chat",
        options: options as unknown as Prisma.InputJsonObject,
      },
      select: { id: true },
    });
    const action = await tx.actions.create({
      data: { userId, decisionId: decision.id, type: "insurance_reshop" },
      select: { id: true },
    });
    return { decisionId: decision.id, actionId: action.id };
  });
  await db.insuranceShops.updateMany({
    where: { id: shop.id, status: "open" },
    data: { status: "accepted", answeredAt: now },
  });
  await logAudit(
    { type: "user", id: userId },
    "decision_made",
    { type: "finding", id: finding.id },
    {
      choice: "yes",
      source: "chat",
      changed_options: true,
      decision_id: result.decisionId,
      action_id: result.actionId,
    },
  );
  await track(userId, "decision_yes", {
    finding_type: "insurance_reshop",
    action_type: "insurance_reshop",
    annual_savings_cents: shop.savingCents,
    source: "chat",
  });
  return result;
}
