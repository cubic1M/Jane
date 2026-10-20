import { TightMoneyError, sendTightItem } from "@/lib/tight-money";
import { ChatActionError, type ActionHandler } from "./handler";

// Sending a request when money is tight, from the chat (spec step 177): only on the
// person's tap, one request each time, through the lender stand-in.
export const tightSend: ActionHandler = {
  id: "tight.send",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const target = message.refs.tightItem;
    if (!target)
      throw new ChatActionError("failed", "Something went wrong. Open the plan instead.");
    try {
      const { item, next } = await sendTightItem(userId, target.id, { client, now });
      return {
        answeredWith: action.label,
        note: `Sent to ${item.debtName}. I'll tell you what they answer.${next ? ` Next, if you want it: ${next.label.charAt(0).toLowerCase()}${next.label.slice(1)}.` : ""}`,
      };
    } catch (error) {
      throw error instanceof TightMoneyError ? new ChatActionError("failed", error.message) : error;
    }
  },
};
