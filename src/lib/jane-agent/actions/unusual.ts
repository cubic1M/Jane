import { UnusualError, answerUnusual } from "@/lib/unusual";
import {
  ChatActionError,
  answeredElsewhere,
  type ActionContext,
  type ActionHandler,
} from "./handler";

// "This was me" and "Not me" on unusual activity (spec step 208), through answerUnusual.
// "This was me" teaches the merchant; "Not me" opens a dispute card on the plan and gives
// the steps to lock the card.

function alertOf({ message }: ActionContext) {
  const id = message.refs.alertId;
  if (!id) throw new ChatActionError("failed", "Something went wrong. Open Alerts instead.");
  return id;
}

function handler(id: "unusual.me" | "unusual.not_me", answer: "me" | "not_me"): ActionHandler {
  return {
    id,
    on: "open",
    async run(context) {
      try {
        const out = await answerUnusual(context.userId, alertOf(context), answer, {
          client: context.client,
          now: context.now,
        });
        return {
          answeredWith: context.action.label,
          note: out.note,
          ...(out.steps.length > 0
            ? { body: `${out.note} ${out.steps.map((s, i) => `${i + 1}. ${s}`).join(" ")}` }
            : {}),
          actions:
            out.answer === "not_me"
              ? [{ id: "open", label: "See the dispute card", kind: "link", href: "/plan" }]
              : [],
        };
      } catch (error) {
        if (error instanceof UnusualError) throw answeredElsewhere(error.message);
        throw error;
      }
    },
  };
}

export const unusualMe = handler("unusual.me", "me");
export const unusualNotMe = handler("unusual.not_me", "not_me");
