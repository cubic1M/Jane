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
import { hasKit } from "@/lib/diy";

// Yes, no, or "I'll do it myself" on a decision card. Every answer is kept with the card
// exactly as shown. A yes approves the finding and queues an action for the concierge
// team; a no declines it, and can be undone for a few seconds; do-it-yourself puts the
// finding in progress with no action for the team, until the person marks it done.

const STATUS_FOR: Record<DecisionChoice, FindingStatus> = {
  yes: "approved",
  no: "declined",
  diy: "in_progress",
};

// How long the page offers "Undo" after a no.
export const UNDO_WINDOW_SECONDS = 10;
// Extra time the server allows, for a slow network.
const UNDO_GRACE_SECONDS = 5;

// Findings the person hasn't answered yet.
const DECIDABLE: FindingStatus[] = ["new", "shown"];

export type DecisionErrorCode =
  "not_found" | "already_decided" | "card_changed" | "cannot_undo" | "no_kit";

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
  if (answer.choice === "diy" && !hasKit(card.actionType)) {
    throw new DecisionError("no_kit", "There's no do-it-yourself kit for this one.");
  }

  const result = await db.transaction(async (tx) => {
    // Claims the finding, so two clicks can't both record an answer.
    const claimed = await tx.findings.updateMany({
      where: { id: finding.id, status: { in: DECIDABLE } },
      data: { status: STATUS_FOR[answer.choice] },
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
  const EVENT = { yes: "decision_yes", no: "decision_no", diy: "diy_started" } as const;
  await track(userId, EVENT[answer.choice], {
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

// "I did it" on a do-it-yourself decision. Marks the finding done; from then on its
// savings count in saved-to-date, once (a second click changes nothing).
export async function markDiyDone(
  userId: string,
  decisionId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const decision = await db.decisions.findFirst({
    where: { id: decisionId, choice: "diy", undoneAt: null },
    select: { id: true, findingId: true, diyDoneAt: true },
  });
  if (!decision) throw new DecisionError("not_found", "That decision doesn't exist.");
  if (decision.diyDoneAt) return;

  const marked = await db.transaction(async (tx) => {
    const { count } = await tx.decisions.updateMany({
      where: { id: decision.id, diyDoneAt: null },
      data: { diyDoneAt: now },
    });
    if (count > 0) {
      await tx.findings.updateMany({
        where: { id: decision.findingId, status: "in_progress" },
        data: { status: "done" },
      });
    }
    return count > 0;
  });
  if (!marked) return;
  await logAudit(
    { type: "user", id: userId },
    "diy_done",
    { type: "finding", id: decision.findingId },
    { decision_id: decision.id },
  );
  await track(userId, "diy_done", {});
}
