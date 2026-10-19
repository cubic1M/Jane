import { formatCents } from "@/lib/money";
import { adviceMode } from "@/lib/advice-mode";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { WithholdingError, keepRefund, recordW4Change } from "@/lib/tax-withholding";
import { balancePhrase } from "@/planning/tax-estimate-copy";
import { w4Step } from "../tax-w4";
import { ChatActionError, type ActionContext, type ActionHandler } from "./handler";

// A new W-4 from the chat (spec step 121), demo advice only: the walk-through moves on in
// the same message; "I've sent it" records the change (src/lib/tax-withholding.ts) so the
// estimate counts it. Jane never sends anything to an employer.

async function demoAdviceOnly({ userId, client }: ActionContext) {
  if (!(await adviceMode(userId, { client }))) {
    throw new ChatActionError("failed", "That's only offered in demo advice mode.");
  }
}

export const taxW4Start: ActionHandler = {
  id: "tax.w4_start",
  on: "open",
  async run(context) {
    await demoAdviceOnly(context);
    const step = w4Step(1, context.message.refs);
    return {
      status: "open",
      body: step.body,
      actions: step.actions,
      refs: step.refs,
      answeredWith: null,
      note: "OK: three steps.",
    };
  },
};

export const taxW4Next: ActionHandler = {
  id: "tax.w4_next",
  on: "open",
  async run(context) {
    await demoAdviceOnly(context);
    const at = context.message.refs.w4Flow;
    if (at !== 1 && at !== 2)
      throw new ChatActionError("failed", "Something went wrong. Start again from Taxes.");
    const step = w4Step(at === 1 ? 2 : 3, context.message.refs);
    return {
      status: "open",
      body: step.body,
      actions: step.actions,
      refs: step.refs,
      answeredWith: null,
    };
  },
};

export const taxW4Sent: ActionHandler = {
  id: "tax.w4_sent",
  on: "open",
  async run(context) {
    await demoAdviceOnly(context);
    const { userId, client, now, message, action } = context;
    const { w4Step: step, w4AmountCents: amount, w4JanuaryCents: january } = message.refs;
    if ((step !== "4b" && step !== "4c") || typeof amount !== "number") {
      throw new ChatActionError("failed", "Something went wrong. Start again from Taxes.");
    }
    try {
      await recordW4Change(userId, { step, amountCents: amount }, { client, now, via: "chat" });
    } catch (error) {
      if (error instanceof WithholdingError) throw new ChatActionError("failed", error.message);
      throw error;
    }
    const view = await loadTaxEstimate(userId, { client, now });
    const later =
      typeof january === "number" && january !== amount
        ? ` In January, change it to ${formatCents(january)} for a full year.`
        : "";
    return {
      answeredWith: action.label,
      note: `Got it. I'm counting it from your next paycheck: your estimate is now ${balancePhrase(view.estimate.refundCents)}.${later}`,
    };
  },
};

export const taxW4Stop: ActionHandler = {
  id: "tax.w4_stop",
  on: "open",
  async run({ action }) {
    return { answeredWith: action.label, note: "OK, nothing's changed. Your W-4 stays as it is." };
  },
};

export const taxW4Keep: ActionHandler = {
  id: "tax.w4_keep",
  on: "open",
  async run({ userId, client, now, action }) {
    const view = await loadTaxEstimate(userId, { client, now });
    await keepRefund(userId, view.year, { client, via: "chat" });
    return { answeredWith: action.label, note: "OK. I won't bring it up again this year." };
  },
};
