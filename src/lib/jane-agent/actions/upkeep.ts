import { formatCents } from "@/lib/money";
import {
  UpkeepError,
  applyTuneUp,
  countGoalTransfer,
  keepTuneUp,
  skipGoalTransfer,
  undoTuneUp,
} from "@/lib/plan-upkeep";
import {
  answeredElsewhere,
  ChatActionError,
  type ActionContext,
  type ActionHandler,
} from "./handler";

// Buttons for plans that keep up (spec step 101), through the upkeep's own code: Accept
// all, Keep and Undo on a budget tune-up; Count it and Not this one on a transfer.

const wrong = () => new ChatActionError("failed", "Something went wrong. Open it instead.");

function month({ message }: ActionContext) {
  const value = message.refs.tuneUpMonth;
  if (!value || !/^\d{4}-\d{2}$/.test(value)) throw wrong();
  return value;
}
function transaction({ message }: ActionContext) {
  const value = message.refs.transactionId;
  if (!value) throw wrong();
  return value;
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof UpkeepError) throw answeredElsewhere(error.message);
    throw error;
  }
}

export const tuneUpAccept: ActionHandler = {
  id: "tuneup.accept",
  on: "open",
  async run(context) {
    const { userId, client, now } = context;
    const changes = await guarded(() =>
      applyTuneUp(userId, month(context), "accepted", { client, now }),
    );
    return {
      answeredWith: context.action.label,
      note: `Done. ${changes.length === 1 ? "Your budget is" : "Your budgets are"} updated.`,
    };
  },
};

export const tuneUpKeep: ActionHandler = {
  id: "tuneup.keep",
  on: "open",
  async run(context) {
    const { userId, client, now } = context;
    await guarded(() => keepTuneUp(userId, month(context), { client, now }));
    return { answeredWith: context.action.label, note: "OK. Your budgets stay as they are." };
  },
};

// Undo works on Jane's own message about what she changed, while it's still open.
export const tuneUpUndo: ActionHandler = {
  id: "tuneup.undo",
  on: "open",
  async run(context) {
    const { userId, client, now } = context;
    await guarded(() => undoTuneUp(userId, month(context), { client, now }));
    return {
      answeredWith: context.action.label,
      note: "Undone. Your budgets are back to what they were.",
    };
  },
};

export const transferCount: ActionHandler = {
  id: "transfer.count",
  on: "open",
  async run(context) {
    const { userId, client, now } = context;
    const counted = await guarded(() =>
      countGoalTransfer(userId, transaction(context), "counted", { client, now }),
    );
    return {
      answeredWith: context.action.label,
      note: `Counted. "${counted.goalName}" is at ${formatCents(counted.savedCents)} of ${formatCents(counted.targetCents)}.`,
    };
  },
};

export const transferSkip: ActionHandler = {
  id: "transfer.skip",
  on: "open",
  async run(context) {
    const { userId, client, now } = context;
    await guarded(() => skipGoalTransfer(userId, transaction(context), { client, now }));
    return { answeredWith: context.action.label, note: "OK. I won't count that one." };
  },
};
