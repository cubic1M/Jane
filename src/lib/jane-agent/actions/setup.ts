import { ProposalError, acceptAllProposals, answerProposal, openProposals } from "@/lib/proposals";
import {
  ChatActionError,
  answeredElsewhere,
  type ActionContext,
  type ActionHandler,
} from "./handler";

// Set-up suggestions from the chat (spec step 83), through the plan's own code
// (src/lib/proposals.ts): "Set it up" and "No" answer the one suggestion (a no is kept, so
// it doesn't come back); "Use all N suggestions" sets up every open budget and goal, like
// the plan's one tap. Only while the suggestion is still open.

function keyOf({ message }: ActionContext): string {
  const key = message.refs.proposalKey;
  if (!key) throw new ChatActionError("failed", "Something went wrong. Open the plan instead.");
  return key;
}

async function answer(context: ActionContext, accept: boolean) {
  const { userId, client, now } = context;
  try {
    await answerProposal(userId, keyOf(context), accept, {}, { client, now });
  } catch (error) {
    if (error instanceof ProposalError) throw answeredElsewhere(error.message);
    throw error;
  }
}

export const setupYes: ActionHandler = {
  id: "setup.yes",
  on: "open",
  async run(context) {
    await answer(context, true);
    return { answeredWith: context.action.label, note: "Done. It's set up." };
  },
};

export const setupNo: ActionHandler = {
  id: "setup.no",
  on: "open",
  async run(context) {
    await answer(context, false);
    return { answeredWith: context.action.label, note: "OK. I won't suggest it again." };
  },
};

export const setupAll: ActionHandler = {
  id: "setup.all",
  on: "open",
  async run(context) {
    const { userId, client, now } = context;
    const key = keyOf(context);
    // This message's own suggestion must still be open.
    if (!(await openProposals(userId, { client })).some((p) => p.key === key)) {
      throw answeredElsewhere("That suggestion isn't open anymore.");
    }
    const n = await acceptAllProposals(userId, { client, now });
    return {
      answeredWith: context.action.label,
      note: `Done. I set up ${n} ${n === 1 ? "suggestion" : "suggestions"}.`,
    };
  },
};
