import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { CARD_SELECT, buildCard } from "@/lib/cards";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { optionsForNeed } from "./load";
import type { Need } from "./types";

// Picking an option (spec step 276): one tap queues the action for the concierge team. Recorded
// like every other yes: a finding for the cover, a decision with the chosen option kept in its
// options (and whether it adds missing cover or replaces a policy), and a queued action. The
// team does it by hand; nothing changes cover by itself. Only for demo advice mode (the same
// people the stand-in answers for). Asking again never queues twice.

type Options = { client?: PrismaClient; now?: Date };

export class PickError extends Error {}

// What the decision keeps about the pick, for the concierge.
export type CoverPickOptions = {
  coverPick: {
    need: Need["kind"];
    optionId: string;
    carrier: string;
    annualPremiumCents: number;
    coverage: Record<string, number | boolean>;
    deductibleCents: number | null;
    partnerQuoteId: string;
    // Adds cover that was missing (true) or replaces a policy they have (false).
    newCover: boolean;
    policyId: string | null;
  };
};

export async function pickOption(
  userId: string,
  topic: Need["kind"],
  optionId: string,
  { client = defaultClient, now = new Date(), policyId }: Options & { policyId?: string } = {},
): Promise<{ decisionId: string; actionId: string; newCover: boolean }> {
  if (!(await adviceMode(userId, { client }))) {
    throw new PickError("Options to pick from are only available in demo mode for now.");
  }
  const found = await optionsForNeed(userId, topic, { client, now, policyId });
  const option = found?.set.options.find((o) => o.id === optionId);
  if (!found || !option) {
    throw new PickError("That option isn't available anymore. Ask me for fresh ones.");
  }
  const db = scopedFor(userId, client);
  const newCover = found.set.policyId === null;
  const key = `cover:${topic}:${found.set.policyId ?? "new"}:${now.toISOString().slice(0, 7)}`;
  const existing = await db.findings.findFirst({
    where: { key },
    select: { id: true, status: true },
  });
  if (existing && existing.status !== "new" && existing.status !== "shown") {
    throw new PickError("You've already picked this one: it's with the team.");
  }
  const finding =
    existing ??
    (await db.findings.create({
      data: {
        userId,
        type: "insurance_reshop",
        key,
        title: `${option.carrier}: ${option.whyThisOne.replace(/\.$/, "")}`,
        annualSavingsCents: 0,
        amountCents: option.annualPremiumCents,
        confidence: "medium",
        evidence: {
          merchant: option.carrier,
          annualCostCents: option.annualPremiumCents,
          coverPick: true,
        },
      },
      select: { id: true, status: true },
    }));
  const cardRow = await db.findings.findFirstOrThrow({
    where: { id: finding.id },
    select: CARD_SELECT,
  });
  const card = buildCard(cardRow);
  const options: CoverPickOptions = {
    coverPick: {
      need: topic,
      optionId,
      carrier: option.carrier,
      annualPremiumCents: option.annualPremiumCents,
      coverage: option.coverage as Record<string, number | boolean>,
      deductibleCents: option.deductibleCents,
      partnerQuoteId: option.partnerQuoteId,
      newCover,
      policyId: found.set.policyId,
    },
  };
  const result = await db.transaction(async (tx) => {
    const claimed = await tx.findings.updateMany({
      where: { id: finding.id, status: { in: ["new", "shown"] } },
      data: { status: "approved" },
    });
    if (claimed.count === 0)
      throw new PickError("You've already picked this one: it's with the team.");
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
      cover_pick: `${topic}:${optionId}`,
      cost: formatCents(option.annualPremiumCents),
    },
  );
  await track(userId, "cover_option_picked", { need: topic, new_cover: newCover });
  return { ...result, newCover };
}
