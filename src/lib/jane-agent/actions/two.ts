import { formatCents } from "@/lib/money";
import {
  MoneyForTwoError,
  approveBigMove,
  declineBigMove,
  setSplitRule,
} from "@/lib/money-for-two";
import { answeredElsewhere, type ActionHandler, type ActionContext } from "./handler";

// Buttons for money for two (spec step 242): the split rule (either partner's tap sets it for
// both), and the second tap a big move out of a shared account waits for.

const guarded = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof MoneyForTwoError) throw answeredElsewhere(error.message);
    throw error;
  }
};

const splitBy =
  (rule: "income" | "even", note: string): ActionHandler["run"] =>
  async (context: ActionContext) => {
    await guarded(() =>
      setSplitRule(context.userId, rule, { client: context.client, now: context.now }),
    );
    return { answeredWith: context.action.label, note };
  };

export const twoSplitIncome: ActionHandler = {
  id: "two.split_income",
  on: "open",
  run: splitBy("income", "Done. New shared bills split by what each of you earns."),
};

export const twoSplitEven: ActionHandler = {
  id: "two.split_even",
  on: "open",
  run: splitBy("even", "OK. Shared bills stay half each."),
};

export const twoApprove: ActionHandler = {
  id: "two.approve",
  on: "open",
  async run(context) {
    const id = context.message.refs.transferId ?? "";
    const move = await guarded(() =>
      approveBigMove(context.userId, id, { client: context.client, now: context.now }),
    );
    return {
      answeredWith: context.action.label,
      note: `Approved. ${formatCents(move.amountCents)} goes on ${move.runOn}.`,
    };
  },
};

export const twoDecline: ActionHandler = {
  id: "two.decline",
  on: "open",
  async run(context) {
    const id = context.message.refs.transferId ?? "";
    await guarded(() =>
      declineBigMove(context.userId, id, { client: context.client, now: context.now }),
    );
    return { answeredWith: context.action.label, note: "Declined. Nothing moves." };
  },
};
