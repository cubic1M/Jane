import { markNotesSeen } from "@/lib/accountant";
import type { ActionHandler } from "./handler";

// The accountant's answers marked as read (spec step 222).
export const taxAccountantSeen: ActionHandler = {
  id: "tax.accountant_seen",
  on: "open",
  async run({ userId, action, client, now }) {
    await markNotesSeen(userId, { client, now });
    return {
      answeredWith: action.label,
      note: "Okay, I'll keep their answers on your accountant page.",
    };
  },
};
