import type { PrismaClient } from "@/generated/prisma/client";
import { FitPickError, pickFitOption } from "@/lib/fit-pick";
import { AcceptShopError, acceptShop } from "@/lib/insurance/accept";
import { PickError, pickOption } from "@/lib/insurance/need/pick";
import { shopIdOf } from "@/lib/insurance/shop-card";
import type { NeedKind } from "@/lib/insurance/need/types";
import type { OfferedOptions } from "@/lib/option-card";
import type { MessageAction } from "../types";
import { ChatActionError, answeredElsewhere, type ActionHandler } from "./handler";

// The pick-one card in the chat (refs.options, shown as the floating pick card). The screen
// answers a tap at once; this is the server's half, run behind it.
//
// option.pick: the option's id comes with the tap. It must be one the message offered, then
// the card's own lane picks it: insurance cover through pickOption (step 276), a reshop's
// quotes through acceptShop (steps 104–105, Jane's agent switches), loans through
// pickFitOption (step 282). Each prices the options again, refuses a stale or made-up one and
// queues the pick once for the concierge team. Nothing is bought, applied for or moved.
// option.later: the whole set is put off; the message stays in the history as dismissed.

// The two buttons a message with refs.options offers. The chat draws them on the floating
// card, not under the message; offering them is what lets the server check a tap.
export const OPTION_ACTIONS: MessageAction[] = [
  { id: "option.pick", label: "Pick this one", kind: "primary" },
  { id: "option.later", label: "Later", kind: "secondary" },
];

// The errors a lane's picker throws for a stale, made-up or already-answered option.
export const isPickError = (error: unknown): error is Error =>
  error instanceof PickError || error instanceof FitPickError || error instanceof AcceptShopError;

// What the pick did, in a line under the message, and the agent's job it started, if any. The
// comparison cards on the area pages (src/lib/compare-actions.ts) pick through here too.
export async function pickOffered(
  userId: string,
  card: Pick<OfferedOptions, "kind" | "topic" | "policyId">,
  optionId: string,
  at: { client?: PrismaClient; now?: Date } = {},
): Promise<{ note: string; agentJobId?: string }> {
  // A reshop's quotes (step 104): the switch to the picked one, which Jane's agent does.
  const shopId = card.kind === "insurance" ? shopIdOf(card.topic) : null;
  if (shopId) {
    const { agentJobId } = await acceptShop(userId, shopId, { ...at, quoteId: optionId });
    return {
      note: "Done. I'm switching you now: your current policy stays in place until the new one's first payment goes through, then I cancel it from the same day.",
      agentJobId,
    };
  }
  if (card.kind === "insurance") {
    const picked = await pickOption(userId, card.topic as NeedKind, optionId, {
      ...at,
      ...(card.policyId ? { policyId: card.policyId } : {}),
    });
    return {
      note: picked.newCover
        ? "Got it. My team will add that cover for you and tell you when it's done."
        : "Got it. My team will change that on your policy and tell you when it's done.",
    };
  }
  const picked = await pickFitOption(userId, card.topic, optionId, at);
  return {
    note: picked.kept
      ? "Got it: you keep what you have. Nothing to apply for."
      : "Got it. My team will send you the lender's steps; you apply yourself.",
  };
}

export const optionPick: ActionHandler = {
  id: "option.pick",
  on: "open",
  async run({ userId, message, choice, client, now }) {
    const card = message.refs.options;
    const chosen = card?.options.find((o) => o.id === choice);
    if (!card || !chosen) {
      throw new ChatActionError("not_offered", "That option isn't on this card.");
    }
    try {
      const { note, agentJobId } = await pickOffered(userId, card, chosen.id, { client, now });
      return {
        answeredWith: chosen.label,
        note,
        ...(agentJobId ? { agentJobIds: [agentJobId] } : {}),
      };
    } catch (error) {
      if (isPickError(error)) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

export const optionLater: ActionHandler = {
  id: "option.later",
  on: "open",
  async run() {
    return { status: "dismissed", answeredWith: null, note: "OK, not now. Ask me again any time." };
  },
};
