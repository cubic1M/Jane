import { PROFILE_QUESTIONS } from "@/config/investing";
import { answerProfileQuestion } from "@/lib/investments/profile";
import { placeRebalance, RebalanceError } from "@/lib/investments/rebalance";
import { nextQuestion, profileSummary, questionAfter } from "@/planning/investor-profile";
import { asking } from "../investments/profile-question";
import { mixLine, SIMULATED_WORDS } from "../investments/rebalance-copy";
import type { ActionId } from "../types";
import { answeredElsewhere, ChatActionError, type ActionHandler } from "./handler";

// An answer button on Jane's investor-profile question (spec step 129), saved through the
// profile's own code like the profile page. The message stays open with the next question
// until all four are in. Jane never answers for the person, at any autopilot level.

function answer(position: number): ActionHandler {
  return {
    id: `invest.answer.${position}` as ActionId,
    on: "open",
    async run({ userId, message, action, client, now }) {
      const question = PROFILE_QUESTIONS.find((q) => q.key === message.refs.investQuestion);
      const choice = question?.choices[position - 1];
      if (!question || !choice) {
        throw new ChatActionError("not_offered", "That button isn't on this message.");
      }
      const answers = await answerProfileQuestion(userId, question.key, choice.value, {
        client,
        now,
      });
      const again = message.refs.investAgain === true;
      const next = again ? questionAfter(question.key) : nextQuestion(answers);
      if (next) {
        const ask = asking(next, again);
        return {
          status: "open",
          answeredWith: null,
          refs: { ...message.refs, ...ask.refs },
          note: ask.refs.note,
          actions: ask.actions,
        };
      }
      const summary = profileSummary(answers, now.toISOString().slice(0, 10));
      const { investQuestion: _, investAgain: __, ...refs } = message.refs;
      return {
        answeredWith: action.label,
        refs,
        note: summary.complete
          ? `Thanks. Your profile: ${summary.why} You can change it any time.`
          : "Thanks.",
        actions: [
          { id: "open", label: "See your profile", kind: "link", href: "/investments/profile" },
        ],
      };
    },
  };
}

export const investAnswer1 = answer(1);
export const investAnswer2 = answer(2);
export const investAnswer3 = answer(3);
export const investAnswer4 = answer(4);
export const investAnswer5 = answer(5);

// "Move to the recommended mix" (spec step 133): places the plan's orders through the
// brokerage partner's own code, as the rebalance page does, only while the plan is the
// one the message showed. Moving money always needs this tap, at every autopilot level.
export const investRebalance: ActionHandler = {
  id: "invest.rebalance",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const key = message.refs.rebalanceKey;
    if (!key) throw new ChatActionError("not_offered", "That button isn't on this message.");
    try {
      const { confirmations, plan } = await placeRebalance(userId, key, { client, now });
      const filled = confirmations.filter((c) => c.status === "filled").length;
      return {
        answeredWith: action.label,
        note: `Done ${SIMULATED_WORDS}: ${filled} of ${confirmations.length} orders filled. Your mix is now ${mixLine(plan.after)}.`,
        actions: [
          { id: "open", label: "See the orders", kind: "link", href: "/investments/rebalance" },
        ],
      };
    } catch (error) {
      if (error instanceof RebalanceError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};
