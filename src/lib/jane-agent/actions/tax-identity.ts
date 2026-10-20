import { isSign } from "@/planning/tax-identity";
import { IdentityError, markHavePin, markStep, openCase, remindIpPin } from "@/lib/tax-identity";
import { ChatActionError, type ActionHandler } from "./handler";

// A protected tax identity from the chat (spec step 218): the IP PIN reminder, opening a
// case on a sign, and ticking off each step. Jane keeps the list; the steps are the
// person's own.

const failed = (error: unknown): never => {
  if (error instanceof IdentityError) throw new ChatActionError("failed", error.message);
  throw error;
};

export const taxIpPinRemind: ActionHandler = {
  id: "tax.ippin_remind",
  on: "open",
  async run({ userId, action, client, now }) {
    const dueOn = await remindIpPin(userId, { client, now, via: "chat" }).catch(failed);
    return {
      answeredWith: action.label,
      note: `Done: getting your IP PIN is on your deadlines for ${dueOn}.`,
    };
  },
};

export const taxIpPinHave: ActionHandler = {
  id: "tax.ippin_have",
  on: "open",
  async run({ userId, action, client, now }) {
    await markHavePin(userId, { client, now });
    return { answeredWith: action.label, note: "Good: you're protected for this year's return." };
  },
};

export const taxIdentityOpen: ActionHandler = {
  id: "tax.identity_open",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const sign = message.refs.identitySign;
    const source = message.refs.identitySource;
    if (!isSign(sign))
      throw new ChatActionError("failed", "Something went wrong. Open Taxes instead.");
    const view = await openCase(
      userId,
      sign,
      source === "rejected" || source === "notice" ? source : "told",
      {
        client,
        now,
      },
    ).catch(failed);
    return {
      answeredWith: action.label,
      note: `I'm sorry. Here's the plan, in order: ${view.steps.map((s) => s.title.toLowerCase()).join(", then ")}. I'll take you through each.`,
    };
  },
};

export const taxIdentityNot: ActionHandler = {
  id: "tax.identity_not",
  on: "open",
  async run({ action }) {
    return {
      answeredWith: action.label,
      note: "OK. If it turns out to be, tell me and I'll give you the steps.",
    };
  },
};

export const taxIdentityStep: ActionHandler = {
  id: "tax.identity_step",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const step = message.refs.identityStep;
    if (!step) throw new ChatActionError("failed", "Something went wrong. Open Taxes instead.");
    const view = await markStep(userId, step, { client, now }).catch(failed);
    return {
      answeredWith: action.label,
      note: view.complete
        ? "That's every step. Keep copies of what you sent."
        : "Noted. I'll bring up the next one.",
    };
  },
};
