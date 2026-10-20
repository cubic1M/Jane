import { CardInterestError, sendRateRequest } from "@/lib/card-interest";
import { ChatActionError, type ActionHandler } from "./handler";

// Asking a card for a lower rate from the chat (spec step 224): only on the person's tap,
// one card each time, through the lender stand-in.
export const cardRateSend: ActionHandler = {
  id: "cardrate.send",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const target = message.refs.cardRate;
    if (!target) {
      throw new ChatActionError("failed", "Something went wrong. Open your card interest instead.");
    }
    try {
      const { cardName } = await sendRateRequest(userId, target.id, { client, now });
      return {
        answeredWith: action.label,
        note: `Sent to ${cardName}. I'll tell you what they answer.`,
      };
    } catch (error) {
      throw error instanceof CardInterestError
        ? new ChatActionError("failed", error.message)
        : error;
    }
  },
};
