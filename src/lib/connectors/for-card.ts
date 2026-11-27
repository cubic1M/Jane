import type { ActionType, PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { cancelAction, ConnectorRefused, planAction, type PlannedAction } from "./pipeline";
import type { ActionDetails } from "./types";

// A card's act, when a connector can do it, goes through the one planner (./pipeline.ts planAction):
// the registry, the flags, consent and the caps decide there, and the person's yes on exactly those
// steps comes after (answerAction). Every "yes" reaches here through recordDecision: the card, the
// plan page, a standing rule and the chat alike. An act with no row below has no connector yet, and
// one no connector may do for this person (switched off, no consent, a check that says no) stays
// the team's or the person's own, as before.

type CardAct = {
  findingId: string;
  actionType: ActionType;
  annualSavingsCents: number | null;
  evidence: unknown;
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const evidenceOf = (card: CardAct): Record<string, unknown> =>
  card.evidence && typeof card.evidence === "object" && !Array.isArray(card.evidence)
    ? (card.evidence as Record<string, unknown>)
    : {};

// The connectors that can do each act, real ones first, and what each is asked, from the finding's
// own evidence. Null when the finding doesn't say enough to ask.
const ACTS: Partial<
  Record<
    ActionType,
    { connectorIds: readonly string[]; request: (card: CardAct) => ActionDetails | null }
  >
> = {
  cancel_subscription: {
    connectorIds: ["sandbox_subscription_cancel"],
    request: (card) => {
      const merchant = text(evidenceOf(card).merchant);
      if (!merchant || !card.annualSavingsCents) return null;
      return {
        merchant,
        monthlyCents: Math.round(card.annualSavingsCents / 12),
        descriptor: text(evidenceOf(card).descriptor),
      };
    },
  },
};

export const connectorsForAct = (actionType: ActionType): readonly string[] =>
  ACTS[actionType]?.connectorIds ?? [];

// The plan for a card's act through the first connector that may do it, or null. One plan per
// finding: asking again returns it.
export async function planForCard(
  userId: string,
  card: CardAct,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<PlannedAction | null> {
  const act = ACTS[card.actionType];
  const request = act?.request(card);
  if (!act || !request) return null;
  for (const connectorId of act.connectorIds) {
    try {
      return await planAction(userId, connectorId, request, {
        idempotencyKey: `finding:${card.findingId}`,
        client,
        now,
      });
    } catch (error) {
      if (error instanceof ConnectorRefused) continue;
      throw error;
    }
  }
  return null;
}

// Takes back a finding's plan while nothing has reached a partner (still waiting for the person's
// yes, or in its hold), and frees its key so a later yes plans afresh. True when it did. Used when
// the card's yes is reverted, and when a yes lost the claim on its finding to another answer.
// The cancel and the key's release are one conditional write (cancelAction's `beforePartner`), so a
// plan that began running after the lookup is left alone and a cancelled one never keeps the key.
// A plan already cancelled that still holds the key (the person cancelled it on Connections, or the
// stop-all switch did) is released here too, so the finding can be planned again.
export async function cancelCardPlan(
  userId: string,
  findingId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<boolean> {
  const key = `finding:${findingId}`;
  const db = scopedFor(userId, client);
  const plan = await db.connectorActions.findFirst({
    where: { idempotencyKey: key },
    select: { id: true, status: true },
  });
  if (!plan) return false;
  const freed = `${key}:cancelled:${plan.id}`;
  if (plan.status === "cancelled") {
    await db.connectorActions.updateMany({
      where: { id: plan.id, idempotencyKey: key, status: "cancelled" },
      data: { idempotencyKey: freed },
    });
    return true;
  }
  const cancelled = await cancelAction(userId, plan.id, {
    client,
    now,
    beforePartner: { idempotencyKey: freed },
  });
  if (cancelled) return true;
  // Another caller (Connections, stop-all) may have cancelled it between the lookup and here: it
  // is cancelled and still holds the key, which frees it. A plan that is running stays as it is.
  const { count } = await db.connectorActions.updateMany({
    where: { id: plan.id, idempotencyKey: key, status: "cancelled" },
    data: { idempotencyKey: freed },
  });
  return count > 0;
}
