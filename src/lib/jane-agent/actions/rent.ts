import { answerRentQuestion } from "@/lib/rent-question";
import type { ActionHandler } from "./handler";
import { ChatActionError } from "./handler";

// The two buttons on "Is this your rent?" (CSV bench, round 24). Either answer is the person's
// own rule for that payee, so Jane never asks about them again.
export function rentAnswer(isRent: boolean): ActionHandler {
  return {
    id: isRent ? "rent.yes" : "rent.no",
    on: "open",
    async run({ userId, message, client }) {
      const key = message.refs.rentKey;
      if (!key) throw new ChatActionError("not_offered", "That button isn't on this message.");
      const { updated } = await answerRentQuestion(userId, key, isRent, { client });
      return {
        answeredWith: isRent ? "Yes, it's rent" : "No",
        note: isRent
          ? `Thanks: ${updated} ${updated === 1 ? "payment is" : "payments are"} now rent, and the next ones will be too. You can change it under Transactions.`
          : "OK, I'll keep those as transfers and won't ask again.",
      };
    },
  };
}
