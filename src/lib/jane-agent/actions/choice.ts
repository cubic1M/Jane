import type { AutopilotLevel, PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { DecisionError, undoPick } from "@/lib/decisions";
import { rulesFor, saveRules } from "@/lib/standing-rules";
import type { ChatMessage, ChosenRef, MessageAction, MessageRefs } from "../types";
import { ChatActionError, type ActionHandler, type ActionOutcome } from "./handler";

// A pick-one choice stays on its message (founder, 2026-10-25: "It should also not just remove
// the options, just grey them out, and there should be a revert button"): the autopilot level and
// the option cards' picks keep their buttons, greyed with the chosen one marked (the chat draws
// them from previousActions), and one Revert, which puts back what the choice changed: the level
// and standing rules from before, or the queued pick, while the team hasn't started on it.

export const REVERT: MessageAction = { id: "choice.revert", label: "Revert", kind: "secondary" };
// Done on the chosen card: it stops floating and settles into the chat's history.
export const DONE: MessageAction = { id: "choice.done", label: "Done", kind: "secondary" };

const links = (actions: MessageAction[]) => actions.filter((a) => a.kind === "link");

// What a choice handler returns besides its answer: the choices kept, Revert offered.
export function keepChoice(
  message: ChatMessage,
  action: MessageAction,
  undo: Omit<ChosenRef, "actionId" | "label">,
): Pick<ActionOutcome, "refs" | "actions"> {
  const chosen: ChosenRef = { actionId: action.id, label: action.label, ...undo };
  return {
    refs: {
      ...message.refs,
      chosen,
      previousActions: message.actions.filter((a) => a.kind !== "link"),
    },
    actions: [...links(message.actions), ...(undo.final ? [] : [REVERT, DONE])],
  };
}

// The autopilot settings a level is about to change, for Revert.
export async function autopilotBefore(
  userId: string,
  client: PrismaClient,
): Promise<NonNullable<ChosenRef["autopilot"]>> {
  const [user, rules] = await Promise.all([
    client.user.findUnique({
      where: { id: userId },
      select: { autopilot: true, acceptSimpleOffers: true },
    }),
    rulesFor(userId, { client }),
  ]);
  return {
    level: user?.autopilot ?? null,
    acceptSimpleOffers: user?.acceptSimpleOffers ?? false,
    rules: rules.map((r) => ({
      key: r.key,
      enabled: r.enabled,
      monthlyLimit: r.monthlyLimit,
      maxAnnualCents: r.maxAnnualCents,
    })),
  };
}

async function restoreAutopilot(
  userId: string,
  before: NonNullable<ChosenRef["autopilot"]>,
  client: PrismaClient,
) {
  await saveRules(userId, before.rules, { client });
  await client.user.update({
    where: { id: userId },
    data: {
      autopilot: before.level as AutopilotLevel | null,
      acceptSimpleOffers: before.acceptSimpleOffers,
    },
  });
  await logAudit(
    { type: "user", id: userId },
    "autopilot_reverted",
    { type: "user", id: userId },
    { level: before.level },
  );
}

export const choiceRevert: ActionHandler = {
  id: "choice.revert",
  on: "answered",
  async run({ userId, message, client, now }) {
    const { chosen, previousActions, ...rest } = message.refs;
    if (!chosen) throw new ChatActionError("failed", "There's nothing to revert here.");
    if (chosen.decisionId) {
      await undoPick(userId, chosen.decisionId, { client, now }).catch((error: unknown) => {
        if (error instanceof DecisionError) throw new ChatActionError("expired", error.message);
        throw error;
      });
    }
    if (chosen.autopilot) await restoreAutopilot(userId, chosen.autopilot, client);
    const refs: MessageRefs = { ...rest };
    delete refs.note;
    return {
      status: "open",
      answeredWith: null,
      refs,
      actions: [...links(message.actions), ...(previousActions ?? [])],
    };
  },
};

export const choiceDone: ActionHandler = {
  id: "choice.done",
  on: "answered",
  async run({ message }) {
    const { chosen } = message.refs;
    if (!chosen) throw new ChatActionError("failed", "There's nothing to settle here.");
    return {
      answeredWith: message.answeredWith,
      refs: { ...message.refs, chosen: { ...chosen, settled: true } },
      actions: message.actions.filter((a) => a.id !== DONE.id),
    };
  },
};
