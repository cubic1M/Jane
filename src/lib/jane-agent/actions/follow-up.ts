import { declineFollowUp, markFollowUpDone, OutcomeError } from "@/lib/follow-through-answers";
import { ChatActionError, answeredElsewhere, type ActionHandler } from "./handler";

// The buttons on a follow-up card (src/lib/jane-agent/sources/follow-through.ts).

const keyOf = (key: string | undefined) => {
  if (!key) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
  return key;
};

export const followUpDone: ActionHandler = {
  id: "followup.done",
  on: "open",
  async run(context) {
    try {
      await markFollowUpDone(context.userId, keyOf(context.message.refs.followUp), {
        client: context.client,
        now: context.now,
      });
    } catch (error) {
      if (error instanceof OutcomeError) throw answeredElsewhere(error.message);
      throw error;
    }
    return {
      answeredWith: context.action.label,
      note: "Marked done. I'll count what it saves once it shows up in your accounts.",
    };
  },
};

export const followUpNo: ActionHandler = {
  id: "followup.no",
  on: "open",
  async run(context) {
    await declineFollowUp(context.userId, keyOf(context.message.refs.followUp), {
      client: context.client,
      now: context.now,
    });
    return { answeredWith: context.action.label, note: "OK, I won't bring that up again." };
  },
};
