import { CHAT_FLOW_OPTIONS } from "@/config/agent-chat";
import type { PrismaClient } from "@/generated/prisma/client";
import { parseMoneyToCents } from "@/lib/money";
import type { ActionId, MessageAction, MessageRefs } from "../types";

// Guided flows in the chat (spec step 95): a short series of questions, one at a time, each
// answered with a button or typed, with Back and Cancel. Where a flow is lives on its
// message (refs.flow), so it can be left and picked up later. Nothing changes until the last
// answer, which runs the feature's own code; cancelling changes nothing. Definitions are in
// ./index.ts; the buttons in ../actions/flows.ts.

export type FlowId = "budget" | "goal" | "switch" | "dispute";

export type FlowOption = { label: string; value: string };

export type FlowQuestion = {
  question: string;
  options: FlowOption[];
  // An answer may be typed instead: an amount ("$400") or words ("a new laptop").
  typed?: "amount" | "text";
};

export type FlowContext = { userId: string; client: PrismaClient; now: Date };

export type FlowDef<D> = {
  id: FlowId;
  title: string;
  // What the questions need (the categories, the findings), loaded fresh for each step.
  load(context: FlowContext, answers: Answers): Promise<D>;
  // Said instead of the first question when there's nothing to do.
  none(data: D): string | null;
  steps: { key: string; ask(answers: Answers, data: D): FlowQuestion }[];
  // The last answer: the feature's own code. Returns what happened, in a line.
  finish(answers: Answers, data: D, context: FlowContext): Promise<string>;
};

export type Answers = Record<string, string>;

// What a flow's message carries.
export type FlowState = {
  id: FlowId;
  step: number;
  answers: Answers;
  // The values behind this step's buttons, in order (flow.pick.1, flow.pick.2…).
  options: string[];
  typed?: FlowQuestion["typed"];
};

export const PICK_IDS = Array.from(
  { length: CHAT_FLOW_OPTIONS },
  (_, i) => `flow.pick.${i + 1}` as ActionId,
);

// The message for the step the state is on.
export function stepMessage<D>(
  flow: FlowDef<D>,
  state: Pick<FlowState, "step" | "answers">,
  data: D,
): { body: string; actions: MessageAction[]; refs: MessageRefs } {
  const ask = flow.steps[state.step].ask(state.answers, data);
  const options = ask.options.slice(0, CHAT_FLOW_OPTIONS);
  const hint =
    ask.typed === "amount"
      ? " Or type an amount."
      : ask.typed === "text"
        ? " Or type your own."
        : "";
  return {
    body: `${flow.title}, ${state.step + 1} of ${flow.steps.length}: ${ask.question}${hint}`,
    actions: [
      ...options.map((o, i): MessageAction => ({
        id: PICK_IDS[i],
        label: o.label,
        kind: "secondary",
      })),
      ...(state.step > 0
        ? [{ id: "flow.back" as ActionId, label: "Back", kind: "secondary" as const }]
        : []),
      { id: "flow.cancel", label: "Cancel", kind: "secondary" },
    ],
    refs: {
      flow: {
        id: flow.id,
        step: state.step,
        answers: state.answers,
        options: options.map((o) => o.value),
        ...(ask.typed ? { typed: ask.typed } : {}),
      },
    },
  };
}

// A typed answer for a step that takes one, or null when it doesn't fit.
export function typedAnswer(kind: FlowQuestion["typed"], text: string): string | null {
  const words = text.trim();
  if (kind === "amount") {
    const cents = parseMoneyToCents(words.replace(/^\$/, "").replace(/\s*(?:a|per) month$/i, ""));
    return cents !== null && cents > 0 ? String(cents) : null;
  }
  if (kind === "text") return words.length >= 2 && words.length <= 60 ? words : null;
  return null;
}
