import { formatCents } from "@/lib/money";
import { savePreference } from "@/lib/jane-agent/preferences";
import { UNEVEN_INCOME_FACT } from "@/config/steady-pay";
import { SteadyError, payNow } from "@/lib/steady-pay";
import { answeredElsewhere, type ActionHandler } from "./handler";

// Buttons on the steady paycheck (spec step 240): Pay me now (the person's tap; the plan is
// worked out again and never takes the buffer under its floor), Not this month, and "My income
// is uneven", which turns it on.

export const steadyPay: ActionHandler = {
  id: "steady.pay",
  on: "open",
  async run(context) {
    try {
      const paid = await payNow(context.userId, "person", {
        client: context.client,
        now: context.now,
      });
      return {
        answeredWith: context.action.label,
        note: `Done. ${formatCents(paid.amountCents)} goes from your buffer to checking on ${paid.runOn}; you can undo it on Transfers until then.`,
      };
    } catch (error) {
      if (error instanceof SteadyError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

export const steadySkip: ActionHandler = {
  id: "steady.skip",
  on: "open",
  async run(context) {
    return { answeredWith: context.action.label, note: "OK, nothing moves this month." };
  },
};

export const steadyOn: ActionHandler = {
  id: "steady.on",
  on: "open",
  async run(context) {
    await savePreference(
      context.userId,
      { kind: "fact", key: UNEVEN_INCOME_FACT, value: { on: true }, label: "My income is uneven" },
      { client: context.client },
    );
    return {
      answeredWith: context.action.label,
      note: "Got it. Ask me about your steady paycheck once I've seen a few months of income.",
    };
  },
};
