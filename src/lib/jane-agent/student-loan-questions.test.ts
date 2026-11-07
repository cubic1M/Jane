import { describe, expect, it } from "vitest";
import { decisionIdFor } from "./debt-decide";
import { parseDebtIntent } from "./debt-intents";

// The chat's fourth policy round (11-06), with Claude refusing so the rules answered: questions
// that name student loans got the costliest card ("You owe $3,120.00 across 1 card at 21.49%").
// The card decisions now step aside for them; the same questions about cards are unchanged.
const AS_OF = "2026-11-06";
const debt = (text: string) => parseDebtIntent(text, null, AS_OF);

describe("debt questions that name student loans", () => {
  it("reads consolidating student loans as the student loans' long game", () => {
    for (const text of [
      "should i consolidate my student loans",
      "should i consolidate my student debt",
    ]) {
      expect(debt(text), text).toEqual({ kind: "student_long" });
    }
  });

  it("reads paying student loans off or investing as paying the student loan early", () => {
    for (const text of [
      "should i pay off my student loans early or invest",
      "pay off student loans or invest?",
      "paying down my student loan vs investing",
    ]) {
      expect(debt(text), text).toEqual({ kind: "debt_decision", which: "student_early" });
    }
  });

  it("leaves the same questions about cards and debt to the card decisions", () => {
    expect(debt("should i consolidate my credit cards")).toEqual({
      kind: "debt_decision",
      which: "consolidate",
    });
    expect(debt("should i pay off my card or invest")).toEqual({
      kind: "debt_decision",
      which: "pay_or_invest",
    });
    expect(debt("should i consolidate my debts")).toEqual({
      kind: "debt_decision",
      which: "consolidate",
    });
  });

  it("gives the chat's should-I router the student loan's decision, never a card's", () => {
    expect(decisionIdFor("loan", "pay off my student loans early or invest")).toBe("student_early");
    expect(decisionIdFor("loan", "is it better to pay off student loans or invest")).toBe(
      "student_early",
    );
    expect(decisionIdFor("loan", "consolidate my student loans")).toBeNull();
    expect(decisionIdFor("loan", "consolidate my credit cards")).toBe("consolidate");
    expect(decisionIdFor("payoff_or_invest", "paying off debt or investing")).toBe("pay_or_invest");
  });
});
