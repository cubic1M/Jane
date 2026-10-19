import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { CHAT_FLOW_OPTIONS } from "@/config/agent-chat";
import { ACTION_HANDLERS } from "../actions";
import { parseIntent } from "../intents";
import { PICK_IDS, stepMessage, typedAnswer, type FlowDef } from "./engine";

// Spec step 95: the flow engine's questions, typed answers, and what starts a flow.

const TODAY = "2026-10-19";

const demo: FlowDef<{ colours: string[] }> = {
  id: "goal",
  title: "Testing",
  load: async () => ({ colours: [] }),
  none: () => null,
  steps: [
    {
      key: "colour",
      ask: () => ({
        question: "Which colour?",
        options: ["red", "green", "blue", "cyan", "pink", "gold"].map((c) => ({
          label: c,
          value: c,
        })),
      }),
    },
    {
      key: "amount",
      ask: (answers) => ({ question: `How much ${answers.colour}?`, options: [], typed: "amount" }),
    },
  ],
  finish: async () => "Done.",
};

describe("stepMessage", () => {
  it("asks the first question with an answer button each, and Cancel", () => {
    const message = stepMessage(demo, { step: 0, answers: {} }, { colours: [] });
    expect(message.body).toBe("Testing, 1 of 2: Which colour?");
    expect(message.actions.map((a) => a.id)).toEqual([...PICK_IDS, "flow.cancel"]);
    expect(message.refs.flow).toEqual({
      id: "goal",
      step: 0,
      answers: {},
      options: ["red", "green", "blue", "cyan", "pink"],
    });
  });

  it("offers Back after the first, and says when an answer can be typed", () => {
    const message = stepMessage(demo, { step: 1, answers: { colour: "red" } }, { colours: [] });
    expect(message.body).toBe("Testing, 2 of 2: How much red? Or type an amount.");
    expect(message.actions.map((a) => a.id)).toEqual(["flow.back", "flow.cancel"]);
    expect(message.refs.flow).toMatchObject({ typed: "amount", answers: { colour: "red" } });
  });

  it("has a handler for every answer button", () => {
    expect(PICK_IDS).toHaveLength(CHAT_FLOW_OPTIONS);
    for (const id of [...PICK_IDS, "flow.back", "flow.cancel"]) {
      expect(Object.hasOwn(ACTION_HANDLERS, id), id).toBe(true);
    }
  });
});

describe("typedAnswer", () => {
  it("reads amounts and words, and nothing else", () => {
    expect(typedAnswer("amount", "$450")).toBe("45000");
    expect(typedAnswer("amount", "1,200.50 a month")).toBe("120050");
    expect(typedAnswer("amount", "lots")).toBeNull();
    expect(typedAnswer("amount", "0")).toBeNull();
    expect(typedAnswer("text", "a new laptop")).toBe("a new laptop");
    expect(typedAnswer("text", "x")).toBeNull();
    expect(typedAnswer(undefined, "anything")).toBeNull();
  });
});

describe("starting a flow", () => {
  it.each([
    ["set up a budget", "budget"],
    ["help me make a budget", "budget"],
    ["start a goal", "goal"],
    ["create a savings goal", "goal"],
    ["switch my phone plan", "switch"],
    ["find me a cheaper internet", "switch"],
    ["dispute a charge", "dispute"],
    ["I was charged twice", "dispute"],
    ["continue", "resume"],
    ["where were we", "resume"],
  ])("reads %s", (text, flow) => {
    expect(parseIntent(text, TODAY)).toEqual({ kind: "flow", flow });
  });

  it("leaves other questions alone", () => {
    expect(parseIntent("how are my goals doing", TODAY)).toEqual({ kind: "goals" });
    expect(parseIntent("how much is my budget", TODAY).kind).not.toBe("flow");
    expect(parseIntent("my tax profile", TODAY)).toMatchObject({ kind: "tax" });
    expect(parseIntent("my risk profile", TODAY)).toMatchObject({ kind: "investments" });
  });
});
