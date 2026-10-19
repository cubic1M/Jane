import { answerByRules } from "../answer";
import { storeReply } from "../messages";
import type { ActionId } from "../types";
import { ChatActionError, type ActionHandler } from "./handler";

// Spec step 88: a clarifying question's buttons, one per meaning ("Which one do you mean?
// [Hulu] [Peacock]"). A tap answers that meaning with the rules, as a new answer under the
// question, exactly as if the person had typed it. It changes nothing by itself: any
// action is a button on that answer.

function clarify(n: 1 | 2 | 3): ActionHandler {
  return {
    id: `clarify.${n}` as ActionId,
    on: "open",
    async run({ userId, message, client, now }) {
      const choice = message.refs.choices?.[n - 1];
      if (!choice) throw new ChatActionError("failed", "Something went wrong. Ask me again.");
      const reply = (await answerByRules(userId, choice.intent, { client, now })) ?? {
        body: "That isn't there anymore. Ask me again.",
        actions: [],
        refs: {},
      };
      await storeReply(userId, reply, { client, at: new Date(now.getTime() + 1) });
      return { answeredWith: choice.label, posted: true };
    },
  };
}

export const clarifyOne = clarify(1);
export const clarifyTwo = clarify(2);
export const clarifyThree = clarify(3);
