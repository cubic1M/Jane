import type { Reply } from "../replies";
import { answerInvestments } from "../investments/answer";
import { type CapabilityContext } from "./shared";

// Investing (spec step 190): the rules' answers for these kinds of question, one registered
// capability each in ./index.ts. Moved out of ../answer.ts unchanged.

async function answer(ctx: CapabilityContext): Promise<Reply | null> {
  const { intent } = ctx;
  const { userId, client, now } = ctx;

  switch (intent.kind) {
    case "investments":
      return answerInvestments(userId, intent, { client, now });
    default:
      return null;
  }
}

export const investingAnswer = answer;
