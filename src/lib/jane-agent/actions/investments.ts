import { PROFILE_QUESTIONS } from "@/config/investing";
import { answerProfileQuestion } from "@/lib/investments/profile";
import { placeRebalance, RebalanceError } from "@/lib/investments/rebalance";
import {
  AutoInvestError,
  setAutoInvestStatus,
  startAutoInvest,
} from "@/lib/investments/auto-invest";
import { AUTO_LINK, runLine } from "../investments/auto-copy";
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

// Automatic investing (spec step 134): starting it is the person's one tap; after that Jane
// runs it on every payday herself. Through automatic investing's own code, like its page.
function autoStart(id: ActionId, mode: "fixed" | "leftover"): ActionHandler {
  return {
    id,
    on: "open",
    async run({ userId, message, action, client, now }) {
      const offer = message.refs.autoInvest;
      if (!offer) throw new ChatActionError("not_offered", "That button isn't on this message.");
      try {
        const run = await startAutoInvest(
          userId,
          {
            mode,
            amountCents: mode === "fixed" ? offer.amountCents : null,
            accountId: offer.accountId,
          },
          { client, now },
        );
        return {
          answeredWith: action.label,
          note: `It's on. ${run ? runLine(run) : "I'll start with your next paycheck."}`,
          actions: [AUTO_LINK],
        };
      } catch (error) {
        if (error instanceof AutoInvestError) throw answeredElsewhere(error.message);
        throw error;
      }
    },
  };
}

export const investAutoStart = autoStart("invest.auto_start", "fixed");
export const investAutoLeftover = autoStart("invest.auto_leftover", "leftover");

function autoStatus(id: ActionId, status: "active" | "paused"): ActionHandler {
  return {
    id,
    on: "open",
    async run({ userId, action, client }) {
      try {
        await setAutoInvestStatus(userId, status, { client });
      } catch (error) {
        if (error instanceof AutoInvestError) throw answeredElsewhere(error.message);
        throw error;
      }
      return {
        answeredWith: action.label,
        note:
          status === "paused"
            ? "Paused. I won't invest from your paychecks until you turn it back on."
            : "Back on from your next paycheck.",
        actions: [AUTO_LINK],
      };
    },
  };
}

export const investAutoPause = autoStatus("invest.auto_pause", "paused");
export const investAutoResume = autoStatus("invest.auto_resume", "active");
