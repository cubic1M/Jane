import type { Reply } from "../replies";
import type { MessageRefs } from "../types";
import { stepMessage, type Answers, type FlowContext, type FlowId, type FlowState } from "./engine";
import { FLOWS } from "./index";

// Moving a guided flow along (spec step 95): its first question, the next after an answer,
// the one before on Back, and the end in the feature's own code after the last answer.

// The first question, or why there's nothing to do.
export async function startFlow(id: FlowId, context: FlowContext): Promise<Reply> {
  const flow = FLOWS[id];
  const data = await flow.load(context, {});
  const none = flow.none(data);
  if (none) return { body: none, actions: [], refs: {} };
  return stepMessage(flow, { step: 0, answers: {} }, data);
}

export type FlowMove =
  | { done: false; body: string; actions: Reply["actions"]; refs: MessageRefs }
  | { done: true; note: string };

// After an answer to the step the state is on: the next question, or the end.
export async function answerFlow(
  state: FlowState,
  value: string,
  context: FlowContext,
): Promise<FlowMove> {
  const flow = FLOWS[state.id];
  const answers: Answers = { ...state.answers, [flow.steps[state.step].key]: value };
  const data = await flow.load(context, answers);
  if (state.step + 1 >= flow.steps.length) {
    return { done: true, note: await flow.finish(answers, data, context) };
  }
  return { done: false, ...stepMessage(flow, { step: state.step + 1, answers }, data) };
}

// The question the state is on, again (picking a flow up later).
export async function showFlow(
  state: FlowState,
  context: FlowContext,
): Promise<{ body: string; actions: Reply["actions"]; refs: MessageRefs }> {
  const flow = FLOWS[state.id];
  return stepMessage(flow, state, await flow.load(context, state.answers));
}

// One step back, keeping the answers.
export async function backFlow(state: FlowState, context: FlowContext): Promise<FlowMove> {
  const flow = FLOWS[state.id];
  const step = Math.max(0, state.step - 1);
  return {
    done: false,
    ...stepMessage(flow, { step, answers: state.answers }, await flow.load(context, state.answers)),
  };
}
