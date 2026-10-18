import {
  PLAN_NEVER_PRESELECTED,
  PLAN_OPTIONS,
  PLAN_URGENT_FINDING_TYPES,
  type PlanOption,
} from "@/config/plan";
import type { ActionType, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import {
  ACTION_FOR_FINDING,
  CARD_SELECT,
  buildCard,
  cardHash,
  type DecisionCard,
} from "@/lib/cards";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { DecisionError, recordDecision, type DecisionResult } from "@/lib/decisions";
import { partnerForUser, type CardPartner } from "@/lib/referrals";

// Jane's plan: every open finding as a proposed action, most urgent and most valuable
// first, answered Yes / No / Change. Answers go through the same decision log as the
// cards, marked as coming from the plan.

type Options = { client?: PrismaClient };

export type PlanItem = {
  card: DecisionCard;
  cardHash: string;
  urgent: boolean;
  options: readonly PlanOption[];
  // Ticked for the week's one tap: what Jane would do. Low-confidence findings,
  // cancellations and moving money start unticked (step 59).
  preselected: boolean;
};

export async function planFor(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<PlanItem[]> {
  const db = scopedFor(userId, client);
  const findings = await db.findings.findMany({
    where: { status: { in: ["new", "shown"] } },
    select: { ...CARD_SELECT, createdAt: true, confidence: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  // One partner lookup per action type, not per card.
  const partners = new Map<ActionType, CardPartner | null>();
  // Urgent types in the config's order (a balance about to run low first), then the rest.
  const urgency = (type: (typeof findings)[number]["type"]) => {
    const index = PLAN_URGENT_FINDING_TYPES.indexOf(type);
    return index === -1 ? PLAN_URGENT_FINDING_TYPES.length : index;
  };
  const items: { item: PlanItem; urgency: number; createdAt: Date }[] = [];
  for (const finding of findings) {
    const actionType = ACTION_FOR_FINDING[finding.type];
    if (!partners.has(actionType)) {
      partners.set(actionType, await partnerForUser(userId, actionType, { client }));
    }
    const card = buildCard(finding, partners.get(actionType) ?? null);
    items.push({
      item: {
        card,
        cardHash: cardHash(card),
        urgent: PLAN_URGENT_FINDING_TYPES.includes(finding.type),
        options: PLAN_OPTIONS[actionType],
        preselected: finding.confidence !== "low" && !PLAN_NEVER_PRESELECTED.includes(actionType),
      },
      urgency: urgency(finding.type),
      createdAt: finding.createdAt,
    });
  }
  return items
    .sort(
      (a, b) =>
        a.urgency - b.urgency ||
        (b.item.card.annualSavingsCents ?? -1) - (a.item.card.annualSavingsCents ?? -1) ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    )
    .map(({ item }) => item);
}

// Seeing the plan counts as seeing each card in it.
export async function markPlanShown(
  userId: string,
  findingIds: string[],
  { client = defaultClient }: Options = {},
): Promise<void> {
  if (findingIds.length === 0) return;
  await scopedFor(userId, client).findings.updateMany({
    where: { id: { in: findingIds }, status: "new" },
    data: { status: "shown" },
  });
}

export type PlanAnswer = {
  findingId: string;
  cardHash: string;
  choice: "yes" | "no";
  options?: Record<string, unknown>;
};

export type PlanAnswerResult =
  | ({ findingId: string; ok: true } & DecisionResult)
  | { findingId: string; ok: false; message: string };

export async function answerPlanItem(
  userId: string,
  answer: PlanAnswer,
  { client = defaultClient }: Options = {},
): Promise<PlanAnswerResult> {
  try {
    const result = await recordDecision(userId, { ...answer, source: "plan" }, { client });
    return { findingId: answer.findingId, ok: true, ...result };
  } catch (error) {
    if (!(error instanceof DecisionError)) throw error;
    return { findingId: answer.findingId, ok: false, message: error.message };
  }
}

// "Yes to all": one decision per item, each with Jane's defaults. Items that changed or
// were answered elsewhere are skipped and reported, never half-recorded.
export async function yesToAll(
  userId: string,
  items: { findingId: string; cardHash: string }[],
  { client = defaultClient }: Options = {},
): Promise<PlanAnswerResult[]> {
  const results: PlanAnswerResult[] = [];
  for (const item of items) {
    results.push(await answerPlanItem(userId, { ...item, choice: "yes" }, { client }));
  }
  await track(userId, "plan_yes_to_all", {
    items: items.length,
    approved: results.filter((r) => r.ok).length,
  });
  return results;
}
