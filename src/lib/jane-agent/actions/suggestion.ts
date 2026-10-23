import { answerPracticeIdea } from "@/lib/practice/ideas";
import { SuggestionError, answerSuggestion, explainSuggestion } from "@/lib/suggestions";
import {
  ChatActionError,
  answeredElsewhere,
  type ActionContext,
  type ActionHandler,
} from "./handler";

// "Yes" and "Not for me" on one of Jane's suggestions (spec step 255), through
// answerSuggestion. A no is for good: the nightly scan never offers it again. A practice idea
// (Phase AW) also gets its answer: Yes places its trades in the practice ledger, within the
// caps, or opens the practice settings; No puts it away.

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
        const key = keyOf(context);
        const options = { client: context.client, now: context.now };
        const out = await answerSuggestion(context.userId, key, answer, options);
        const practice = await answerPracticeIdea(context.userId, key, answer, options);
        if (practice) {
          return {
            answeredWith: context.action.label,
            note: practice.note,
            ...(answer === "yes"
              ? {
                  actions: [
                    {
                      id: "open" as const,
                      label: "See it",
                      kind: "link" as const,
                      href: practice.href,
                    },
                  ],
                }
              : {}),
          };
        }
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

// "Why?": the short card gives way to the whole explanation in place. The message stays open
// with its other buttons; nothing is decided.
export const suggestionWhy: ActionHandler = {
  id: "suggestion.why",
  on: "open",
  async run(context) {
    try {
      const body = await explainSuggestion(context.userId, keyOf(context), {
        client: context.client,
      });
      return {
        status: "open",
        answeredWith: null,
        body,
        refs: context.message.refs,
        actions: context.message.actions.filter((a) => a.id !== "suggestion.why"),
      };
    } catch (error) {
      if (error instanceof SuggestionError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};
