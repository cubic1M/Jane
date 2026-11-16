import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Debugger 11-16 (a Chase checking upload on a phone, paying Nelnet and Toyota Motor Credit):
// "how much do I owe on my loans?" read "I can't find "loans" among your debts. You have: Nelnet
// Student Loan, Toyota Motor Credit car loan.", and "how much is my car payment?" read "You spent
// $36.62 on Transportation in November", not the $338.12 a month to the car loan.

const intent = (text: string) => parseIntent(text, "2026-11-16");

describe("loans in the plural", () => {
  it("are every debt", () => {
    for (const text of [
      "how much do I owe on my loans?",
      "how much do I owe on my debts",
      "how much do we owe on our credit cards",
      "when will my loans be paid off",
    ]) {
      expect(intent(text), text).toEqual({ kind: "debts" });
    }
  });

  it("one loan is still that loan", () => {
    expect(intent("how much do I owe on my car")).toEqual({ kind: "debt_detail", target: "car" });
  });
});

describe("a loan's payment", () => {
  it("is that loan, not a spending category", () => {
    expect(intent("how much is my car payment?")).toEqual({ kind: "debt_detail", target: "car" });
    expect(intent("what's my student loan payment")).toEqual({
      kind: "debt_detail",
      target: "student loan",
    });
  });
});
