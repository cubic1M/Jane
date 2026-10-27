import { CHANGE_KINDS } from "@/insights/changes";
import { BudgetError, setBudget } from "@/lib/budgets";
import { ChangeError, markChangeExpected } from "@/lib/changes";
import { formatCents, centsToInput } from "@/lib/money";
import { findingNo, findingYes } from "./finding";
import { ChatActionError, type ActionContext, type ActionHandler } from "./handler";

// Buttons on Jane's heads-ups about changes (spec step 97), through the features' own
// code: "Look into it" says yes to the finding that acts on the change (a price fight, a
// reshop or a fee refund), like Yes on its card; "Set a budget" sets the category's budget
// as Budgets does; "That's expected" keeps the change from ever coming up again (and, when
// Jane offered to act on it, is a No to that, like No on its card).

const wrong = () => new ChatActionError("failed", "Something went wrong. Open it instead.");

function changeOf({ message }: ActionContext) {
  const change = message.refs.change;
  if (!change || !(CHANGE_KINDS as readonly string[]).includes(change.kind)) throw wrong();
  return change as typeof change & { kind: (typeof CHANGE_KINDS)[number] };
}

export const changeLook: ActionHandler = {
  id: "change.look",
  on: "open",
  async run(context) {
    if (!context.message.refs.findingId) throw wrong();
    return findingYes.run(context);
  },
};

export const changeBudget: ActionHandler = {
  id: "change.budget",
  on: "open",
  async run(context) {
    const { category, budgetCents } = changeOf(context);
    if (!category || !budgetCents) throw wrong();
    try {
      await setBudget(context.userId, category, centsToInput(budgetCents), {
        client: context.client,
      });
    } catch (error) {
      if (error instanceof BudgetError) throw new ChatActionError("failed", error.message);
      throw error;
    }
    return {
      answeredWith: context.action.label,
      note: `Done. Your ${category} budget is ${formatCents(budgetCents)} a month. You can change it on Budgets.`,
    };
  },
};

export const changeExpected: ActionHandler = {
  id: "change.expected",
  on: "open",
  async run(context) {
    const { key, kind } = changeOf(context);
    // A price rise or fee Jane offered to act on: expected means No to that, with its Undo.
    const no = context.message.refs.findingId ? await findingNo.run(context) : null;
    try {
      await markChangeExpected(context.userId, key, kind, { client: context.client });
    } catch (error) {
      if (error instanceof ChangeError) throw new ChatActionError("failed", error.message);
      throw error;
    }
    const note = "OK. I won't bring this one up again.";
    return no
      ? { ...no, answeredWith: context.action.label, note }
      : {
          answeredWith: context.action.label,
          note,
        };
  },
};
