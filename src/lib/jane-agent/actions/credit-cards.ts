import { DEMO_CARD_ARRIVES } from "@/config/credit-cards";
import { CreditCardError, applyForCard } from "@/lib/credit-cards";
import { ChatActionError, type ActionHandler } from "./handler";

// Applying for a card from the chat (spec step 174), through src/lib/credit-cards.ts: the
// person's tap is the application. Jane never applies by herself.

export const creditCardApply: ActionHandler = {
  id: "credit_card.apply",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const target = message.refs.creditCard;
    if (!target)
      throw new ChatActionError("failed", "Something went wrong. Open your cards instead.");
    try {
      const app = await applyForCard(userId, target.productId, { client, now });
      const note =
        app.status === "approved"
          ? `Approved: ${app.issuer} says your ${app.cardName} arrives in ${DEMO_CARD_ARRIVES}. Once it's linked I'll show which purchases go on it.`
          : app.status === "declined"
            ? `${app.issuer} declined the ${app.cardName}. Nothing else changes; I'll keep using your current cards at their best.`
            : `Sent. ${app.issuer} is reviewing your ${app.cardName}; I'll tell you what they say.`;
      return { answeredWith: action.label, note };
    } catch (error) {
      throw error instanceof CreditCardError ? new ChatActionError("failed", error.message) : error;
    }
  },
};
