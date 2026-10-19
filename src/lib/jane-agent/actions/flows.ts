import { answerFlow, backFlow } from "../flows/run";
import type { ActionId } from "../types";
import {
  ChatActionError,
  type ActionContext,
  type ActionHandler,
  type ActionOutcome,
} from "./handler";

// A guided flow's buttons (spec step 95). Each answer moves the same message on to the next
// question; the last runs the feature's own code. Back goes one question back; Cancel ends
// it, changing nothing.

const wrong = () => new ChatActionError("failed", "Something went wrong. Start it again.");

function moved(move: Awaited<ReturnType<typeof answerFlow>>, label: string | null): ActionOutcome {
  if (move.done) return { answeredWith: label, note: move.note };
  return {
    status: "open",
    answeredWith: null,
    body: move.body,
    actions: move.actions,
    refs: move.refs,
  };
}

function pick(n: number): ActionHandler {
  return {
    id: `flow.pick.${n}` as ActionId,
    on: "open",
    async run({ userId, message, action, client, now }: ActionContext) {
      const state = message.refs.flow;
      const value = state?.options[n - 1];
      if (!state || value === undefined) throw wrong();
      return moved(await answerFlow(state, value, { userId, client, now }), action.label);
    },
  };
}

// One per answer button (CHAT_FLOW_OPTIONS of them).
export const FLOW_PICKS = {
  "flow.pick.1": pick(1),
  "flow.pick.2": pick(2),
  "flow.pick.3": pick(3),
  "flow.pick.4": pick(4),
  "flow.pick.5": pick(5),
} as const satisfies Record<`flow.pick.${number}`, ActionHandler>;

export const flowBack: ActionHandler = {
  id: "flow.back",
  on: "open",
  async run({ userId, message, client, now }) {
    const state = message.refs.flow;
    if (!state) throw wrong();
    return moved(await backFlow(state, { userId, client, now }), null);
  },
};

export const flowCancel: ActionHandler = {
  id: "flow.cancel",
  on: "open",
  async run({ action }) {
    return {
      status: "dismissed",
      answeredWith: action.label,
      note: "OK, I've stopped. Nothing was changed.",
    };
  },
};
