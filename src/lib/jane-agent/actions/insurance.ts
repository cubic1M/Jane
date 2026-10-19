import { GAP_KEYS, type GapKey } from "@/config/insurance";
import { dismissGap } from "@/lib/insurance/household";
import { AcceptShopError, acceptShop } from "@/lib/insurance/accept";
import { requestQuotes } from "@/lib/insurance/quotes";
import { markCheckupSeen } from "@/lib/insurance/checkups";
import { declineShop } from "@/lib/insurance/shop";
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

// Yes on Jane's pick (spec step 104): the one tap. Recorded as a yes on the policy's
// insurance_reshop finding, with an action for the switch (src/lib/insurance/accept.ts).
export const insuranceShopYes: ActionHandler = {
  id: "insurance.shop_yes",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const { insuranceShopId } = message.refs;
    if (!insuranceShopId) {
      throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    }
    try {
      const { actionId, agentJobId } = await acceptShop(userId, insuranceShopId, {
        client,
        now,
      });
      return {
        answeredWith: action.label,
        note: "Done. I'm switching you now: your current policy stays in place until the new one's first payment goes through, then I cancel it from the same day.",
        refs: { ...message.refs, actionId },
        agentJobIds: [agentJobId],
      };
    } catch (error) {
      if (error instanceof AcceptShopError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

// Not now: keeps the current policy this time. Jane shops it again before the next renewal
// or if the price goes up.
export const insuranceShopNo: ActionHandler = {
  id: "insurance.shop_no",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const { insuranceShopId } = message.refs;
    if (!insuranceShopId) {
      throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    }
    if (!(await declineShop(userId, insuranceShopId, { client, now }))) {
      throw answeredElsewhere("This one's already been answered.");
    }
    return {
      answeredWith: action.label,
      note: "OK, you'll keep your current policy. I'll shop it again before it next renews.",
    };
  },
};

// "Got it" on the coverage checkup (spec step 106): seen, so Jane doesn't bring it up again.
export const insuranceCheckupSeen: ActionHandler = {
  id: "insurance.checkup_seen",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const { insuranceCheckupId } = message.refs;
    if (!insuranceCheckupId) {
      throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    }
    if (!(await markCheckupSeen(userId, insuranceCheckupId, { client, now }))) {
      throw answeredElsewhere("You've already seen this checkup.");
    }
    return {
      answeredWith: action.label,
      note: "OK. I'll check your cover again in a year, or sooner if your life changes.",
    };
  },
};
