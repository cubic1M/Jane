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

  it("reads a question about getting out of debt, with any extra a month", () => {
    for (const text of [
      "What's the fastest way out of debt?",
      "how do I pay off my debt",
      "when will I be debt free",
      "which card should I pay off first",
      "show me my payoff plan",
    ]) {
      expect(intent(text), text).toEqual({ kind: "payoff_plan", extraCents: null });
    }
    expect(intent("what if I pay $200 more a month")).toEqual({
      kind: "payoff_plan",
      extraCents: 20_000,
    });
    expect(intent("paying an extra 150 toward my debts")).toEqual({
      kind: "payoff_plan",
      extraCents: 15_000,
    });
  });

  it("leaves requests and other questions alone", () => {
    expect(intent("lower the rate on my card")).toMatchObject({ kind: "act", verb: "lower" });
    expect(intent("what's due this week")).toMatchObject({ kind: "coming_up" });
    expect(intent("how much did I spend on food last month")).toMatchObject({ kind: "spending" });
    expect(intent("can I afford $900 for a trip in March")).toMatchObject({ kind: "afford" });
  });
});
