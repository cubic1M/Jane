import { AGENT_FOLLOW_UP_DAYS } from "@/config/agent";
import { TURNAROUND_BUSINESS_DAYS } from "@/config/concierge";
import type { ActionType, DecisionChoice } from "@/generated/prisma/client";
import { ACTION_FOR_FINDING, CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { scopedFor } from "@/lib/db-scoped";
import { DIY_KITS } from "@/config/diy";
import { DecisionError, UNDO_WINDOW_SECONDS, markDiyDone, recordDecision } from "@/lib/decisions";
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

// Spec step 90: after a Yes, what happens next and when, in plain words.
export function nextStep(type: ActionType): string {
  const followUp = `If they don't answer, I follow up after ${AGENT_FOLLOW_UP_DAYS} days.`;
  switch (type) {
    case "cancel_subscription":
      return `Got it. I'll write to them today to cancel, and tell you here when they confirm. ${followUp}`;
    case "fight_price_increase":
      return `Got it. I'll ask them today to undo the price rise, and tell you here what they say. ${followUp}`;
    case "request_refund":
    case "recover_bank_fees":
      return `Got it. I'll ask for the money back today, and tell you here when it lands. ${followUp}`;
    case "negotiate_bill":
      return "Got it. I'll call them for a lower price and bring any offer back to you here before saying yes to it.";
    default:
      return `Got it. Our team starts on it within ${TURNAROUND_BUSINESS_DAYS} business day${TURNAROUND_BUSINESS_DAYS === 1 ? "" : "s"}, and I'll tell you here what's next.`;
  }
}

const ALREADY: ActionOutcome = {
  answeredWith: null,
  note: "You'd already answered this one.",
};

async function decide(
  context: ActionContext,
  choice: Extract<DecisionChoice, "yes" | "no">,
  switchTo?: string,
): Promise<ActionOutcome & { decisionId?: string; actionType?: ActionType; diy?: boolean }> {
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
      actionType: ACTION_FOR_FINDING[finding.type],
      agentJobIds: [result.agentJobId],
      diy: result.diy,
    };
  } catch (error) {
    if (!(error instanceof DecisionError)) throw error;
    if (error.code === "already_decided") return ALREADY;
    throw new ChatActionError("failed", error.message);
  }
}

// Read-only mode (CONCIERGE_ACTIONS): a real account's Yes is theirs to do. The steps in the
// chat, the drafts (email, script, Copy) on the finding's page, and "Mark done" for when it's
// done, so what it saved is counted.
export function diySteps(type: ActionType): string {
  const steps = DIY_KITS[type]?.steps ?? [];
  return [
    "Here's how to do it yourself:",
    ...steps.map((step, i) => `${i + 1}. ${step}`),
    "Tap Mark done once it's done.",
  ].join("\n");
}

function diyOutcome(
  context: ActionContext,
  outcome: ActionOutcome & { decisionId?: string; actionType?: ActionType },
): ActionOutcome {
  const findingId = context.message.refs.findingId;
  return {
    ...outcome,
    agentJobIds: [],
    note: diySteps(outcome.actionType!),
    refs: { ...context.message.refs, decisionId: outcome.decisionId },
    actions: [
      { id: "diy.done", label: "Mark done", kind: "primary" },
      {
        id: "open",
        label: "Steps and drafts",
        kind: "link",
        href: `/report/${findingId}#diy`,
      },
    ],
  };
}

export const findingYes: ActionHandler = {
  id: "finding.yes",
  on: "open",
  async run(context) {
    const outcome = await decide(context, "yes");
    if (outcome.decisionId && outcome.actionType && outcome.diy) {
      return diyOutcome(context, outcome);
    }
    return outcome.decisionId && outcome.actionType
      ? { ...outcome, note: nextStep(outcome.actionType) }
      : outcome;
  },
};

// "Mark done" on a Yes the person did themselves: counted from then on (markDiyDone).
export const diyDone: ActionHandler = {
  id: "diy.done",
  on: "answered",
  async run(context) {
    const { decisionId } = context.message.refs;
    if (!decisionId) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    try {
      await markDiyDone(context.userId, decisionId, { client: context.client, now: context.now });
    } catch (error) {
      if (!(error instanceof DecisionError)) throw error;
      throw new ChatActionError("not_found", "That's not there anymore.");
    }
    return {
      answeredWith: context.action.label,
      note: "Marked done. I'll count what it saves once it shows up in your accounts.",
      actions: linksOf(context.message.actions),
    };
  },
};

export const findingPick: ActionHandler = {
  id: "finding.pick",
  on: "open",
  async run(context) {
    const switchTo = context.message.refs.pickOptionId;
    if (!switchTo) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    const outcome = await decide(context, "yes", switchTo);
    if (outcome.decisionId && outcome.actionType && outcome.diy) {
      return diyOutcome(context, outcome);
    }
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
