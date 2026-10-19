import type { DecisionChoice } from "@/generated/prisma/client";
import { ACTION_FOR_FINDING, CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { scopedFor } from "@/lib/db-scoped";
import { DecisionError, UNDO_WINDOW_SECONDS, recordDecision } from "@/lib/decisions";
import { partnerForUser } from "@/lib/referrals";
import { findingFingerprint } from "../snapshot";
import {
  ChatActionError,
  linksOf,
  type ActionContext,
  type ActionHandler,
  type ActionOutcome,
} from "./handler";

// Yes, No and Jane's pick on a finding (spec step 81), through recordDecision with the
// card's hash, like a tap on the card itself, from source "chat". A pick goes as the
// option to switch to (src/lib/compare.ts checks it's still on offer). Moving money,
// cancelling, insurance and calls are all fine here: this is the person's own tap.

const ALREADY: ActionOutcome = {
  answeredWith: null,
  note: "You'd already answered this one.",
};

async function decide(
  context: ActionContext,
  choice: Extract<DecisionChoice, "yes" | "no">,
  switchTo?: string,
): Promise<ActionOutcome & { decisionId?: string }> {
  const { userId, message, client } = context;
  const { findingId, fingerprint } = message.refs;
  if (!findingId) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
  const finding = await scopedFor(userId, client).findings.findFirst({
    where: { id: findingId },
    select: { ...CARD_SELECT, status: true },
  });
  if (!finding) throw new ChatActionError("not_found", "That's not there anymore.");
  if (finding.status !== "new" && finding.status !== "shown") return ALREADY;
  // Only while the finding is what the message said.
  if (findingFingerprint(finding) !== fingerprint) {
    throw new ChatActionError(
      "failed",
      "This one changed since I posted it. Open it to look again.",
    );
  }
  const card = buildCard(
    finding,
    await partnerForUser(userId, ACTION_FOR_FINDING[finding.type], { client }),
  );
  try {
    const result = await recordDecision(
      userId,
      {
        findingId,
        choice,
        cardHash: cardHash(card),
        source: "chat",
        ...(switchTo ? { options: { switchTo } } : {}),
      },
      { client },
    );
    return {
      answeredWith: context.action.label,
      decisionId: result.decisionId,
      agentJobIds: [result.agentJobId],
    };
  } catch (error) {
    if (!(error instanceof DecisionError)) throw error;
    if (error.code === "already_decided") return ALREADY;
    throw new ChatActionError("failed", error.message);
  }
}

export const findingYes: ActionHandler = {
  id: "finding.yes",
  on: "open",
  async run(context) {
    const outcome = await decide(context, "yes");
    return outcome.decisionId
      ? { ...outcome, note: "Got it. I'm on it, and you can follow along on Actions." }
      : outcome;
  },
};

export const findingPick: ActionHandler = {
  id: "finding.pick",
  on: "open",
  async run(context) {
    const switchTo = context.message.refs.pickOptionId;
    if (!switchTo) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    const outcome = await decide(context, "yes", switchTo);
    return outcome.decisionId
      ? {
          ...outcome,
          note: "Got it. I'll send you the sign-up step, and cancel the old one only once the new one shows up.",
        }
      : outcome;
  },
};

// A No can be undone for a few seconds, like on the card (UNDO_WINDOW_SECONDS).
export const findingNo: ActionHandler = {
  id: "finding.no",
  on: "open",
  async run(context) {
    const outcome = await decide(context, "no");
    if (!outcome.decisionId) return outcome;
    const { message, now } = context;
    return {
      ...outcome,
      note: "OK, I'll leave it.",
      refs: {
        ...message.refs,
        decisionId: outcome.decisionId,
        undoUntil: new Date(now.getTime() + UNDO_WINDOW_SECONDS * 1000).toISOString(),
        previousActions: message.actions,
      },
      actions: [{ id: "undo.no", label: "Undo", kind: "secondary" }, ...linksOf(message.actions)],
    };
  },
};
