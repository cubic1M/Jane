import { CARD_SELECT, buildCard } from "@/lib/cards";
import { comparisonFor } from "@/lib/compare";
import { conciergeMode } from "@/lib/concierge-mode";
import { scopedFor } from "@/lib/db-scoped";
import { selfServe } from "@/lib/diy";
import { optionsReply, whyReply } from "../explain-replies";
import { storeReply } from "../messages";
import {
  ChatActionError,
  answeredElsewhere,
  type ActionContext,
  type ActionHandler,
  type ActionOutcome,
} from "./handler";

// The quick replies on a finding (spec step 90): "Why?" posts the evidence and what changes,
// "Show options" the options compared, both from the card's own wording, as a new answer
// under the message with the finding's buttons. The message itself stays open, its other
// buttons as they were. Nothing is decided by these taps.

async function explain(context: ActionContext, what: "why" | "options"): Promise<ActionOutcome> {
  const { userId, message, action, client, now } = context;
  const { findingId } = message.refs;
  if (!findingId) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
  const finding = await scopedFor(userId, client).findings.findFirst({
    where: { id: findingId },
    select: { ...CARD_SELECT, status: true },
  });
  if (!finding) throw new ChatActionError("not_found", "That's not there anymore.");
  if (finding.status !== "new" && finding.status !== "shown") {
    throw answeredElsewhere("You've already answered this one.");
  }
  const built = buildCard(finding);
  // A real account hears what they'd do, never "We ..." (read-only mode).
  const card = (await conciergeMode(userId, { client })) ? built : selfServe(built);
  const reply =
    what === "why"
      ? whyReply(card, message.actions)
      : optionsReply(card, await comparisonFor(finding, { userId, client, now }), message.actions);
  await storeReply(
    userId,
    {
      ...reply,
      refs: { ...message.refs, topic: { kind: "act", target: card.title, findingId } },
    },
    { client, at: new Date(now.getTime() + 1) },
  );
  return {
    status: "open",
    answeredWith: null,
    refs: message.refs,
    // That quick reply has been answered; the rest stay.
    actions: message.actions.filter((a) => a.id !== action.id),
    posted: true,
  };
}

export const findingWhy: ActionHandler = {
  id: "finding.why",
  on: "open",
  run: (context) => explain(context, "why"),
};

export const findingOptions: ActionHandler = {
  id: "finding.options",
  on: "open",
  run: (context) => explain(context, "options"),
};
