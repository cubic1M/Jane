import { isLifeEventKind } from "@/config/life-events";
import { LifeEventError, declineLifeGuess, runLifeChecklist } from "@/lib/life-guesses";
import { checklistNote } from "../replies-life";
import {
  ChatActionError,
  answeredElsewhere,
  type ActionContext,
  type ActionHandler,
} from "./handler";

// Buttons on a life event Jane spotted (spec step 100), through the checklists' own code:
// Yes starts the checklist and runs what Jane can do herself (budgets, an insurance review
// and reminders); Not me and Don't ask again stop the question for good.

function kindOf({ message }: ActionContext) {
  const kind = message.refs.lifeKind;
  if (!isLifeEventKind(kind)) {
    throw new ChatActionError("failed", "Something went wrong. Open it instead.");
  }
  return kind;
}

export const lifeYes: ActionHandler = {
  id: "life.yes",
  on: "open",
  async run(context) {
    const kind = kindOf(context);
    try {
      const run = await runLifeChecklist(context.userId, kind, {
        client: context.client,
        now: context.now,
      });
      return { answeredWith: context.action.label, note: checklistNote(kind, run) };
    } catch (error) {
      if (error instanceof LifeEventError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

export const lifeNo: ActionHandler = {
  id: "life.no",
  on: "open",
  async run(context) {
    await declineLifeGuess(context.userId, kindOf(context), "not_me", { client: context.client });
    return {
      answeredWith: context.action.label,
      note: "OK, my mistake. I won't ask about that again.",
    };
  },
};

export const lifeNever: ActionHandler = {
  id: "life.never",
  on: "open",
  async run(context) {
    await declineLifeGuess(context.userId, kindOf(context), "never", { client: context.client });
    return {
      answeredWith: context.action.label,
      note: "OK. I won't ask about life changes again. You can still start a checklist on Life events.",
    };
  },
};
