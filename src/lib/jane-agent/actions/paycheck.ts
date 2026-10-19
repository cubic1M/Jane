import { formatCents } from "@/lib/money";
import {
  PaycheckError,
  movePaycheckPlan,
  skipPaycheckPlan,
  undoPaycheckPlan,
} from "@/lib/money-movement/paycheck";
import { TransferError } from "@/lib/money-movement/transfers";
import {
  ChatActionError,
  answeredElsewhere,
  linksOf,
  type ActionContext,
  type ActionHandler,
} from "./handler";

// Buttons on a paycheck's plan (spec step 144), through the plan's own code: Move them (the
// person's one tap for what autopilot didn't move), Not this time, and Undo for what's still
// pending.

function planOf({ message }: ActionContext) {
  const id = message.refs.paycheckPlanId;
  if (!id) throw new ChatActionError("failed", "Something went wrong. Open Transfers instead.");
  return id;
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PaycheckError || error instanceof TransferError) {
      throw answeredElsewhere(error.message);
    }
    throw error;
  }
}

export const paycheckMove: ActionHandler = {
  id: "paycheck.move",
  on: "open",
  async run(context) {
    const { userId, client, now } = context;
    const moves = await guarded(() => movePaycheckPlan(userId, planOf(context), { client, now }));
    const cents = moves.filter((m) => m.status === "moved").reduce((s, m) => s + m.cents, 0);
    return {
      answeredWith: context.action.label,
      note: `Done. ${formatCents(cents)} is on its way; you can undo it on Transfers until it goes through.`,
    };
  },
};

export const paycheckSkip: ActionHandler = {
  id: "paycheck.skip",
  on: "open",
  async run(context) {
    const { userId, client } = context;
    await guarded(() => skipPaycheckPlan(userId, planOf(context), { client }));
    return {
      answeredWith: context.action.label,
      note: "OK. The rest stays in checking this time.",
    };
  },
};

export const paycheckUndo: ActionHandler = {
  id: "paycheck.undo",
  on: "open",
  async run(context) {
    const { userId, client, now, message } = context;
    const undone = await guarded(() => undoPaycheckPlan(userId, planOf(context), { client, now }));
    return {
      answeredWith: context.action.label,
      note: `Undone: ${undone === 1 ? "that transfer won't" : `those ${undone} transfers won't`} go through.`,
      actions: linksOf(message.actions),
    };
  },
};
