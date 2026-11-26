import { CHAT_FLOW_SETTLE_MS } from "@/config/agent-chat";
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

// A tap on a question that is no longer the one shown: by the showing it carries when the page sent
// one, and otherwise (a tap from a notification) by how soon after the question it came.
function stale(
  state: NonNullable<ActionContext["message"]["refs"]["flow"]>,
  { flowShown, now }: Pick<ActionContext, "flowShown" | "now">,
) {
  if (flowShown !== undefined && state.shown !== undefined) return flowShown !== state.shown;
  return !!state.at && now.getTime() - Date.parse(state.at) < CHAT_FLOW_SETTLE_MS;
}

function pick(n: number): ActionHandler {
  return {
    id: `flow.pick.${n}` as ActionId,
    on: "open",
    async run({ userId, message, action, client, now, flowShown }: ActionContext) {
      const state = message.refs.flow;
      const value = state?.options[n - 1];
      if (!state || value === undefined) throw wrong();
      // The same button ids sit on every step: one drawn for the question before is a double
      // tap on that one, not an answer to this one.
      if (stale(state, { flowShown, now })) {
        throw new ChatActionError(
          "not_open",
          "That question just changed. Pick your answer to this one.",
        );
      }
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
  async run({ userId, message, client, now, flowShown }) {
    const state = message.refs.flow;
    if (!state) throw wrong();
    // Back from a question that is no longer the one shown goes back from the wrong one.
    if (flowShown !== undefined && state.shown !== undefined && flowShown !== state.shown) {
      throw new ChatActionError(
        "not_open",
        "That question just changed. Pick your answer to this one.",
      );
    }
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
