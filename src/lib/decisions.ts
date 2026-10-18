import type {
  DecisionChoice,
  FindingStatus,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// Yes or no on a decision card. Every answer is kept with the card exactly as shown. A
// yes approves the finding and queues an action for the concierge team; a no declines
// it, and can be undone for a few seconds.

// How long the page offers "Undo" after a no.
export const UNDO_WINDOW_SECONDS = 10;
// Extra time the server allows, for a slow network.
const UNDO_GRACE_SECONDS = 5;

// Findings the person hasn't answered yet.
const DECIDABLE: FindingStatus[] = ["new", "shown"];

export type DecisionErrorCode = "not_found" | "already_decided" | "card_changed" | "cannot_undo";

export class DecisionError extends Error {
  constructor(
    readonly code: DecisionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type Options = { client?: PrismaClient; now?: Date };

export type DecisionResult = { decisionId: string; actionId: string | null };

export async function recordDecision(
  userId: string,
  answer: { findingId: string; choice: DecisionChoice; cardHash: string },
  { client = defaultClient }: Options = {},
): Promise<DecisionResult> {
  const db = scopedFor(userId, client);
  const finding = await db.findings.findFirst({
    where: { id: answer.findingId },
    select: { ...CARD_SELECT, status: true },
  });
  if (!finding) throw new DecisionError("not_found", "That finding doesn't exist.");
  if (!DECIDABLE.includes(finding.status)) {
    throw new DecisionError("already_decided", "You've already answered this one.");
  }
  const card = buildCard(finding);
  if (cardHash(card) !== answer.cardHash) {
    throw new DecisionError("card_changed", "This card was updated. Please look at it again.");
  }

  const result = await db.transaction(async (tx) => {
    // Claims the finding, so two clicks can't both record an answer.
    const claimed = await tx.findings.updateMany({
      where: { id: finding.id, status: { in: DECIDABLE } },
      data: { status: answer.choice === "yes" ? "approved" : "declined" },
    });
    if (claimed.count === 0) {
      throw new DecisionError("already_decided", "You've already answered this one.");
    }
    const decision = await tx.decisions.create({
      data: {
        userId,
        findingId: finding.id,
        choice: answer.choice,
        cardSnapshot: card as unknown as Prisma.InputJsonObject,
      },
      select: { id: true },
    });
    const action =
      answer.choice === "yes"
        ? await tx.actions.create({
            data: { userId, decisionId: decision.id, type: card.actionType },
            select: { id: true },
          })
        : null;
    return { decisionId: decision.id, actionId: action?.id ?? null };
  });

  await logAudit(
    { type: "user", id: userId },
    "decision_made",
    { type: "finding", id: finding.id },
    { choice: answer.choice, decision_id: result.decisionId, action_id: result.actionId },
  );
  await track(userId, answer.choice === "yes" ? "decision_yes" : "decision_no", {
    finding_type: card.findingType,
    action_type: card.actionType,
    annual_savings_cents: card.annualSavingsCents,
  });
  return result;
}

export async function undoDecision(
  userId: string,
  decisionId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const decision = await db.decisions.findFirst({
    where: { id: decisionId },
    select: { id: true, findingId: true, choice: true, createdAt: true, undoneAt: true },
  });
  if (!decision) throw new DecisionError("not_found", "That decision doesn't exist.");
  const ageSeconds = (now.getTime() - decision.createdAt.getTime()) / 1000;
  if (
    decision.choice !== "no" ||
    decision.undoneAt ||
    ageSeconds > UNDO_WINDOW_SECONDS + UNDO_GRACE_SECONDS
  ) {
    throw new DecisionError("cannot_undo", "This answer can't be undone anymore.");
  }

  await db.transaction(async (tx) => {
    const undone = await tx.decisions.updateMany({
      where: { id: decision.id, undoneAt: null },
      data: { undoneAt: now },
    });
    if (undone.count === 0) {
      throw new DecisionError("cannot_undo", "This answer can't be undone anymore.");
    }
    await tx.findings.updateMany({
      where: { id: decision.findingId, status: "declined" },
      data: { status: "shown" },
    });
  });

  await logAudit(
    { type: "user", id: userId },
    "decision_undone",
    { type: "finding", id: decision.findingId },
    { decision_id: decision.id },
  );
  await track(userId, "decision_undone", {});
}
