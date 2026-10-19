import { markAlertRead } from "@/lib/alerts";
import { markDeadlineDone } from "@/lib/deadlines";
import { startOfTomorrow } from "../snooze";
import { ChatActionError, answeredElsewhere, type ActionHandler } from "./handler";

// Buttons on Jane's heads-ups (spec step 83), through the pages' own code: "Mark done" on a
// deadline the person typed in (markDeadlineDone, as on Deadlines), "Got it" on an urgent
// alert (marks that one read, as opening Alerts does) and "Not now", which hides a
// heads-up until tomorrow without answering it.

const wrong = () => new ChatActionError("failed", "Something went wrong. Open it instead.");

export const deadlineDone: ActionHandler = {
  id: "deadline.done",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const { deadlineEntryId } = message.refs;
    if (!deadlineEntryId) throw wrong();
    if (!(await markDeadlineDone(userId, deadlineEntryId, { client, now }))) {
      throw answeredElsewhere("That one's already done or gone.");
    }
    return { answeredWith: action.label, note: "Done. I've ticked it off your deadlines." };
  },
};

export const alertGotIt: ActionHandler = {
  id: "alert.got_it",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const { alertId } = message.refs;
    if (!alertId) throw wrong();
    if (!(await markAlertRead(userId, alertId, { client, now }))) {
      throw answeredElsewhere("You've already seen this one.");
    }
    return { answeredWith: action.label, note: "OK. It's marked as read." };
  },
};

// Hidden until the start of the person's tomorrow; Jane's brain brings it back then if it
// still applies (src/lib/jane-agent/brain.ts), never before.
export const snooze: ActionHandler = {
  id: "snooze",
  on: "open",
  async run({ userId, action, client, now }) {
    // Users have their own helpers, so a read of this one column by id.
    const user = await client.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return {
      status: "dismissed",
      answeredWith: action.label,
      note: "OK. I'll bring it up again tomorrow.",
      snoozedUntil: startOfTomorrow(now, user?.timezone),
    };
  },
};
