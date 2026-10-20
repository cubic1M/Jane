import { QuestionError, answerQuestion } from "@/lib/questions";
import type { ActionId } from "../types";
import { ChatActionError, answeredElsewhere, type ActionHandler } from "./handler";

// An answer button on the one question worth asking (spec step 257), saved through the
// profile like a correction on /profile. The fifth button skips; either way it's never asked
// again.

export function askAnswer(position: number): ActionHandler {
  return {
    id: `ask.answer.${position}` as ActionId,
    on: "open",
    async run({ userId, message, action, client, now }) {
      const fact = message.refs.askFact;
      if (!fact) throw new ChatActionError("not_offered", "That button isn't on this message.");
      try {
        const out = await answerQuestion(userId, fact, position, { client, now });
        return {
          answeredWith: action.label,
          note: out.answered
            ? "Thanks, I'll use that. You can change it any time under What Jane knows about you."
            : "OK, I won't ask that again.",
        };
      } catch (error) {
        if (error instanceof QuestionError) throw answeredElsewhere(error.message);
        throw error;
      }
    },
  };
}
