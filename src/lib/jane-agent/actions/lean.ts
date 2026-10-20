import { LeanError, declineLean, loadLeanPlan, startLean } from "@/lib/lean-plan";
import {
  ChatActionError,
  answeredElsewhere,
  type ActionContext,
  type ActionHandler,
} from "./handler";

// Buttons on the lean-plan question (spec step 204). Yes starts it and the message becomes
// the plan itself; No leaves things as they are.

function idOf({ message }: ActionContext) {
  const id = message.refs.leanId;
  if (!id) throw new ChatActionError("failed", "Something went wrong. Ask me again.");
  return id;
}

export const leanStart: ActionHandler = {
  id: "lean.start",
  on: "open",
  async run(context) {
    const { userId, client, now } = context;
    try {
      await startLean(userId, idOf(context), { client, now });
    } catch (error) {
      if (error instanceof LeanError) throw answeredElsewhere(error.message);
      throw error;
    }
    const { message } = await loadLeanPlan(userId, { client, now });
    return {
      answeredWith: context.action.label,
      body: `Lean plan on: automatic transfers are paused until pay is back. ${message}`,
      note: "I'll go back to normal when your pay resumes.",
    };
  },
};

export const leanNotNow: ActionHandler = {
  id: "lean.not_now",
  on: "open",
  async run(context) {
    try {
      await declineLean(context.userId, idOf(context), { client: context.client });
    } catch (error) {
      if (error instanceof LeanError) throw answeredElsewhere(error.message);
      throw error;
    }
    return { answeredWith: context.action.label, note: "OK, nothing changes." };
  },
};
