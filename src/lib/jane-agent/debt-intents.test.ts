import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Spec Phase Y: questions about debts, by rules.
const AS_OF = "2026-10-19";
const intent = (text: string) => parseIntent(text, AS_OF);

describe("debt questions", () => {
  it("reads how much is owed in total", () => {
    for (const text of [
      "How much do I owe?",
      "how much do we still owe",
      "how much debt do I have",
      "what do I owe in total",
      "what are my debts",
      "show me all my loans",
      "my total debt",
    ]) {
      expect(intent(text), text).toEqual({ kind: "debts" });
    }
  });

  it("reads a question about one debt", () => {
    expect(intent("When is my car paid off?")).toEqual({ kind: "debt_detail", target: "car" });
    expect(intent("when will the mortgage be paid off")).toEqual({
      kind: "debt_detail",
      target: "mortgage",
    });
    expect(intent("when do I finish paying off my student loan")).toEqual({
      kind: "debt_detail",
      target: "student loan",
    });
    expect(intent("how much do I owe on my car")).toEqual({ kind: "debt_detail", target: "car" });
    expect(intent("what's the rate on my credit card")).toEqual({
      kind: "debt_detail",
      target: "credit card",
    });
    expect(intent("payoff date for Klarna")).toEqual({ kind: "debt_detail", target: "klarna" });
  });

  it("leaves requests and other questions alone", () => {
    expect(intent("lower the rate on my card")).toMatchObject({ kind: "act", verb: "lower" });
    expect(intent("what's due this week")).toMatchObject({ kind: "coming_up" });
    expect(intent("how much did I spend on food last month")).toMatchObject({ kind: "spending" });
    expect(intent("can I afford $900 for a trip in March")).toMatchObject({ kind: "afford" });
  });
});
