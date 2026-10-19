import { DeadlineError, addDeadline } from "@/lib/deadlines";
import { dismissSaving } from "@/lib/tax-savings";
import type { SavingKey } from "@/planning/tax-savings";
import { ChatActionError, type ActionHandler } from "./handler";

// A way to pay less from the chat (spec step 122): "Remind me" sets the reminder through
// the deadlines' own code (src/lib/deadlines.ts); "Not for me" stops it for the tax year.
// "Start a goal for it" is the goals' own button (./goal.ts).

export const taxSaveTask: ActionHandler = {
  id: "tax.save_task",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const task = message.refs.taxTask;
    if (!task) throw new ChatActionError("failed", "Something went wrong. Open Taxes instead.");
    try {
      await addDeadline(
        userId,
        { title: task.title, dueOn: task.dueOn, kind: "other", note: task.note },
        { client, now },
      );
    } catch (error) {
      if (error instanceof DeadlineError) throw new ChatActionError("failed", error.message);
      throw error;
    }
    const due = new Date(`${task.dueOn}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    return {
      answeredWith: action.label,
      note: `Done: "${task.title}" is on your deadlines for ${due}. I'll remind you.`,
    };
  },
};

export const taxSaveNo: ActionHandler = {
  id: "tax.save_no",
  on: "open",
  async run({ userId, message, action, client }) {
    const { taxSaving, taxYear } = message.refs;
    if (!taxSaving || typeof taxYear !== "number") {
      throw new ChatActionError("failed", "Something went wrong. Open Taxes instead.");
    }
    await dismissSaving(userId, taxYear, taxSaving as SavingKey, { client, via: "chat" });
    return { answeredWith: action.label, note: "OK. I won't suggest it again this year." };
  },
};
