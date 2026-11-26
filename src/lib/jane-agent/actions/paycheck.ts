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
    const { scheduled, skipped } = await guarded(() =>
      movePaycheckPlan(userId, planOf(context), { client, now }),
    );
    // What this tap scheduled, not what autopilot had already moved.
    const cents = scheduled.reduce((s, m) => s + m.cents, 0);
    const left = skipped.reduce((s, m) => s + m.cents, 0);
    const note =
      scheduled.length === 0
        ? `I couldn't move any of it this time, so nothing is on its way. The ${formatCents(left)} stays in checking.`
        : skipped.length === 0
          ? `Done. ${formatCents(cents)} is on its way; you can undo it on Transfers until it goes through.`
          : `Done. ${formatCents(cents)} is on its way; you can undo it on Transfers until it goes through. I couldn't move ${formatCents(left)}, so that stays in checking.`;
    return { answeredWith: context.action.label, note };
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
    const { cancelled, remaining } = await guarded(() =>
      undoPaycheckPlan(userId, planOf(context), { client, now }),
    );
    if (remaining > 0) {
      // Some can't be taken back now and still go through: Undo stays on the message.
      const still = remaining === 1 ? "One transfer" : `${remaining} transfers`;
      return {
        status: "open",
        answeredWith: null,
        note: `${cancelled > 0 ? `Undone: ${cancelled === 1 ? "1 transfer" : `${cancelled} transfers`} won't go through. ` : ""}${still} can't be undone anymore and will still go through.`,
        actions: message.actions,
      };
    }
    return {
      answeredWith: context.action.label,
      note: `Undone: ${cancelled === 1 ? "that transfer won't" : `those ${cancelled} transfers won't`} go through.`,
      actions: linksOf(message.actions),
    };
  },
};
