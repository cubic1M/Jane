import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { startAgent } from "@/lib/agent/run";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { CARD_SELECT, buildCard } from "@/lib/cards";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { sameCompany } from "@/lib/documents/dates";
import { kindWords } from "./gaps";
import { POLICY_SELECT, toPolicy } from "./policies";
import type { StoredQuote } from "./quotes";
import { shopById } from "./shop";

// Yes to Jane's pick (spec step 104): the person's one tap. Recorded like every other yes:
// a decision on the policy's insurance_reshop finding (the one detection found for this
// insurer, or one made for the policy), with the pick kept in its options, and an action
// for the switch, which Jane's agent then does by itself (spec step 105).

type Options = { client?: PrismaClient; now?: Date };

export class AcceptShopError extends Error {}

const DECIDABLE = ["new", "shown"] as const;

const asJson = (q: StoredQuote) => JSON.parse(JSON.stringify(q)) as Prisma.InputJsonObject;

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
  {
    client = defaultClient,
    now = new Date(),
    by = "person",
    quoteId,
  }: Options & {
    // Spec step 141: "autopilot" when Insurance's autopilot said yes within its caps
    // (src/lib/insurance/autopilot.ts); recorded like a standing rule's yes.
    by?: "person" | "autopilot";
    // The quote picked on the chat's pick-one card (src/lib/insurance/shop-card.ts): Jane's
    // pick when left out, or another of the shop's quotes that also costs less.
    quoteId?: string;
  } = {},
): Promise<{ decisionId: string; actionId: string; agentJobId: string }> {
  const db = scopedFor(userId, client);
  const shop = await shopById(userId, shopId, { client });
  if (!shop || shop.status !== "open" || !shop.pick || shop.savingCents === null) {
    throw new AcceptShopError("This one's already been answered.");
  }
  if (shop.expiresAt && shop.expiresAt <= now) {
    throw new AcceptShopError("These quotes have expired. Ask me to shop it again.");
  }
  const chosen =
    !quoteId || quoteId === shop.pick.id ? shop.pick : shop.runnersUp.find((q) => q.id === quoteId);
  if (!chosen)
    throw new AcceptShopError("That quote isn't available anymore. Ask me to shop it again.");
  const savingCents = shop.currentAnnualCents - chosen.annualPremiumCents;
  if (savingCents <= 0) {
    throw new AcceptShopError("That one doesn't cost less than what you pay now.");
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
        annualSavingsCents: savingCents,
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
  const card = buildCard({ ...cardRow, annualSavingsCents: savingCents });
  const options: InsuranceSwitchOptions = {
    insuranceShopId: shop.id,
    insurancePolicyId: policy.id,
    insuranceCarrier: chosen.carrier.name,
    insuranceAnnualCents: chosen.annualPremiumCents,
    insuranceSavingCents: savingCents,
  };

  const result = await db.transaction(async (tx) => {
    const claimed = await tx.findings.updateMany({
      where: { id: finding.id, status: { in: [...DECIDABLE] } },
      data: { status: "approved", annualSavingsCents: savingCents },
    });
    if (claimed.count === 0) throw new AcceptShopError("This one's already been answered.");
    const decision = await tx.decisions.create({
      data: {
        userId,
        findingId: finding.id,
        choice: "yes",
        cardSnapshot: card as unknown as Prisma.InputJsonObject,
        source: by === "autopilot" ? "rule" : "chat",
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
    data: {
      status: "accepted",
      answeredAt: now,
      // Another of the shop's quotes was picked: it becomes the pick the agent binds (step
      // 105), before the agent starts below.
      ...(chosen !== shop.pick
        ? {
            pick: asJson(chosen),
            runnersUp: [shop.pick, ...shop.runnersUp.filter((q) => q.id !== chosen.id)].map(asJson),
            savingCents,
          }
        : {}),
    },
  });
  await logAudit(
    { type: "user", id: userId },
    "decision_made",
    { type: "finding", id: finding.id },
    {
      choice: "yes",
      source: by === "autopilot" ? "rule" : "chat",
      changed_options: true,
      decision_id: result.decisionId,
      action_id: result.actionId,
    },
  );
  await track(userId, "decision_yes", {
    finding_type: "insurance_reshop",
    action_type: "insurance_reshop",
    annual_savings_cents: savingCents,
    source: by === "autopilot" ? "rule" : "chat",
  });
  // Spec step 105: Jane's agent does the switch itself (src/lib/insurance/switch.ts).
  // An autopilot yes waits out the rules' hold, so it can be taken back first.
  const agentJobId = await startAgent(userId, result.actionId, {
    client,
    now,
    source: by === "autopilot" ? "rule" : "chat",
  });
  return { ...result, agentJobId };
}
