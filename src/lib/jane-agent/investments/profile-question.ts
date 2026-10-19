import { PROFILE_QUESTIONS, type ProfileQuestion } from "@/config/investing";
import type { ActionId, MessageAction, MessageRefs } from "../types";

// The investor-profile questions in the chat (spec step 129): one message that asks all
// four in turn. Each tap saves the answer and swaps in the next question and its buttons
// (./../actions/investments.ts); the profile page takes them all at once.

export const PROFILE_LINK: MessageAction = {
  id: "open",
  label: "Answer on the profile page",
  kind: "link",
  href: "/investments/profile",
};

export const PROFILE_INTRO =
  "Before I check whether your investments fit you, four quick questions about what the money is for. Tap an answer; you can change them any time.";

export const questionLine = (q: ProfileQuestion) =>
  `${PROFILE_QUESTIONS.indexOf(q) + 1} of ${PROFILE_QUESTIONS.length}: ${q.text}`;

export const answerButtons = (q: ProfileQuestion): MessageAction[] =>
  q.choices.map((c, i) => ({
    id: `invest.answer.${i + 1}` as ActionId,
    label: c.label,
    kind: "secondary" as const,
  }));

// The buttons and refs for asking `q`. `again`: going through all four once more (the
// yearly check), rather than only the ones not yet answered.
export function asking(
  q: ProfileQuestion,
  again = false,
): { actions: MessageAction[]; refs: MessageRefs } {
  return {
    actions: [...answerButtons(q), PROFILE_LINK],
    refs: { investQuestion: q.key, note: questionLine(q), ...(again ? { investAgain: true } : {}) },
  };
}
