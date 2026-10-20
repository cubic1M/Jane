import { SuggestionError, answerSuggestion } from "@/lib/suggestions";
import {
  ChatActionError,
  answeredElsewhere,
  type ActionContext,
  type ActionHandler,
} from "./handler";

// "Yes" and "Not for me" on one of Jane's suggestions (spec step 255), through
// answerSuggestion. A no is for good: the nightly scan never offers it again.

function keyOf({ message }: ActionContext) {
  const key = message.refs.suggestion;
  if (!key) throw new ChatActionError("failed", "Something went wrong. Ask me again.");
  return key;
}

function handler(id: "suggestion.yes" | "suggestion.no", answer: "yes" | "no"): ActionHandler {
  return {
    id,
    on: "open",
    async run(context) {
      try {
        const out = await answerSuggestion(context.userId, keyOf(context), answer, {
          client: context.client,
          now: context.now,
        });
        return answer === "yes"
          ? {
              answeredWith: context.action.label,
              note: "Good. Here's where to do it.",
              actions: [{ id: "open", label: "Open it", kind: "link", href: out.actionHref }],
            }
          : {
              answeredWith: context.action.label,
              note: "OK, I won't bring that up again.",
            };
      } catch (error) {
        if (error instanceof SuggestionError) throw answeredElsewhere(error.message);
        throw error;
      }
    },
  };
}

export const suggestionYes = handler("suggestion.yes", "yes");
export const suggestionNo = handler("suggestion.no", "no");
