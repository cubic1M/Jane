import { TaxPlanError, addPlanMove, dismissPlanMove } from "@/lib/tax-plan";
import { ChatActionError, type ActionContext, type ActionHandler } from "./handler";

// A tax plan move from the chat (spec step 167), through src/lib/tax-plan.ts: "Add to my
// deadlines" puts its reminder there; "Not for me" stops Jane bringing it up.

const failed = (error: unknown): never => {
  if (error instanceof TaxPlanError) throw new ChatActionError("failed", error.message);
  throw error;
};
const moveOf = ({ message }: ActionContext) => {
  const id = message.refs.taxPlanMove;
  if (!id) throw new ChatActionError("failed", "Something went wrong. Open Taxes instead.");
  return id;
};

export const taxPlanAdd: ActionHandler = {
  id: "tax.plan_add",
  on: "open",
  async run(context) {
    const { userId, client, now, action } = context;
    const move = await addPlanMove(userId, moveOf(context), { client, now, via: "chat" }).catch(
      failed,
    );
    return { answeredWith: action.label, note: `Done: "${move.task.title}" is on your deadlines.` };
  },
};

export const taxPlanNo: ActionHandler = {
  id: "tax.plan_no",
  on: "open",
  async run(context) {
    const { userId, client, now, action } = context;
    await dismissPlanMove(userId, moveOf(context), { client, now, via: "chat" }).catch(failed);
    return { answeredWith: action.label, note: "OK. I won't bring it up again this year." };
  },
};
