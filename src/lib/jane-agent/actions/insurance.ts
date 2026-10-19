import { GAP_KEYS, type GapKey } from "@/config/insurance";
import { dismissGap } from "@/lib/insurance/household";
import { requestQuotes } from "@/lib/insurance/quotes";
import { quotesReply } from "../insurance/quotes";
import { ChatActionError, answeredElsewhere, type ActionHandler } from "./handler";

// Insurance buttons (spec Phase X), through the same code as /insurance.

// "I don't need it" on a coverage gap: never brought up again, here or on the page.
export const insuranceGapNo: ActionHandler = {
  id: "insurance.gap_no",
  on: "open",
  async run({ userId, message, action, client }) {
    const gap = message.refs.insuranceGap;
    if (!gap || !(GAP_KEYS as readonly string[]).includes(gap)) {
      throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    }
    if (!(await dismissGap(userId, gap as GapKey, { client }))) {
      throw answeredElsewhere("You've already told me you don't need it.");
    }
    return { answeredWith: action.label, note: "OK. I won't bring it up again." };
  },
};

// "Compare quotes" on an answer about one policy (spec step 103): asks the insurance
// partner now, through the same code as the quotes page, and says what came back. Asking
// buys nothing.
export const insuranceQuotes: ActionHandler = {
  id: "insurance.quotes",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const { policyId } = message.refs;
    if (!policyId) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    const result = await requestQuotes(userId, policyId, { client, now });
    if (result.kind === "unavailable" && result.reason === "not_found") {
      throw answeredElsewhere("That policy isn't on your insurance anymore.");
    }
    const reply = quotesReply(result);
    return { answeredWith: action.label, note: reply.body, actions: reply.actions };
  },
};
