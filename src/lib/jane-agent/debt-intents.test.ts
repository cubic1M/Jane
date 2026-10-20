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

  it("reads a question about refinancing, with the debt named", () => {
    expect(intent("Can I refinance my car loan?")).toEqual({
      kind: "refinance",
      target: "car loan",
    });
    expect(intent("find me a better rate on my student loan")).toEqual({
      kind: "refinance",
      target: "student loan",
    });
    expect(intent("should I consolidate my credit card")).toEqual({
      kind: "refinance",
      target: "credit card",
    });
    for (const text of ["refinance offers", "any better rates", "refinance"]) {
      expect(intent(text), text).toEqual({ kind: "refinance", target: null });
    }
  });

  it("reads questions about loan applications, and 'apply' as the refinance pick", () => {
    for (const text of [
      "how's my loan application",
      "loan application status",
      "did my loan go through",
    ]) {
      expect(intent(text), text).toEqual({ kind: "loan_status" });
    }
    expect(intent("apply for the refinance")).toEqual({ kind: "refinance", target: null });
    expect(intent("apply for a refinance on my car loan")).toEqual({
      kind: "refinance",
      target: "car loan",
    });
  });

  it("reads questions about 0% balance transfers", () => {
    for (const text of [
      "should I do a balance transfer?",
      "is there a 0% card for my debt",
      "move my credit card balance",
      "transfer my card balance",
    ]) {
      expect(intent(text), text).toEqual({ kind: "balance_transfer" });
    }
  });

  it("reads questions about student loan plans and forgiveness", () => {
    for (const text of [
      "which student loan plan should I be on?",
      "can I lower my student loan payment",
      "am I eligible for PSLF",
      "income-driven repayment",
      "student loan forgiveness",
    ]) {
      expect(intent(text), text).toEqual({ kind: "student_loans" });
    }
    // The payoff date is still the debt itself.
    expect(intent("when is my student loan paid off")).toMatchObject({ kind: "debt_detail" });
  });

  it("reads questions about the mortgage, PMI and escrow", () => {
    for (const text of [
      "can I get rid of PMI?",
      "why did my escrow go up",
      "tell me about my mortgage",
      "what if I pay extra principal on my house",
    ]) {
      expect(intent(text), text).toEqual({ kind: "mortgage" });
    }
    expect(intent("when will my mortgage be paid off")).toMatchObject({ kind: "debt_detail" });
    expect(intent("refinance my mortgage")).toMatchObject({ kind: "refinance" });
  });

  it("reads questions about the credit score", () => {
    for (const text of ["what's my credit score?", "credit report", "my fico"]) {
      expect(intent(text), text).toEqual({ kind: "credit_score" });
    }
  });

  it("reads what Jane does about debts, and what's due on them", () => {
    for (const text of [
      "what do you do about my debts",
      "debt autopilot",
      "autopilot for my loans",
    ]) {
      expect(intent(text), text).toEqual({ kind: "debt_autopilot" });
    }
    for (const text of ["when are my loan payments due", "next card payment", "move my due date"]) {
      expect(intent(text), text).toEqual({ kind: "debt_due" });
    }
  });

  it("reads buy now, pay later questions: what's coming, and whether a new plan fits", () => {
    for (const text of [
      "what buy now pay later payments do I have coming",
      "my klarna installments",
      "when is my next affirm payment due",
    ]) {
      expect(intent(text), text).toEqual({ kind: "bnpl" });
    }
    expect(intent("can I afford a $300 Klarna plan")).toEqual({
      kind: "bnpl_new",
      totalCents: 30_000,
    });
    expect(intent("should I start an affirm plan")).toEqual({ kind: "bnpl_new", totalCents: null });
  });

  it("reads a tight month", () => {
    for (const text of [
      "money is tight this month",
      "I'm short on money",
      "I'm struggling with my bills",
      "I can't afford my rent",
      "hardship help",
    ]) {
      expect(intent(text), text).toEqual({ kind: "tight_money" });
    }
  });

  it("reads building credit, and the score simulator", () => {
    for (const text of [
      "how do I improve my credit",
      "how can I build my credit score",
      "raise my score",
      "do I need a credit builder",
      "when does my statement close",
    ]) {
      expect(intent(text), text).toEqual({ kind: "build_credit" });
    }
    for (const text of [
      "what would my score be if I paid off my card",
      "what if I open a new card, what happens to my score",
      "credit score simulator",
      "how many points would my score go up",
    ]) {
      expect(intent(text), text).toEqual({ kind: "credit_simulate" });
    }
  });

  it("reads which card to use, whether a fee is worth it, and the best card", () => {
    expect(intent("Which card should I use for groceries?")).toEqual({
      kind: "card_for",
      category: "groceries",
    });
    expect(intent("what card should I use for gas")).toEqual({ kind: "card_for", category: "gas" });
    expect(intent("best card for eating out")).toEqual({ kind: "card_for", category: "dining" });
    expect(intent("which card should I use")).toEqual({ kind: "card_for", category: null });
    for (const text of ["is my annual fee worth it", "is my credit card worth the fee"]) {
      expect(intent(text), text).toEqual({ kind: "card_fee" });
    }
    for (const text of [
      "what's the best credit card for me",
      "should I get a new credit card",
      "which credit card should I apply for",
      "credit card rewards",
    ]) {
      expect(intent(text), text).toEqual({ kind: "card_better" });
    }
    // A 0% card is a balance transfer question.
    expect(intent("best 0% card")).toEqual({ kind: "balance_transfer" });
  });

  it("leaves requests and other questions alone", () => {
    expect(intent("lower the rate on my card")).toMatchObject({ kind: "act", verb: "lower" });
    expect(intent("what's due this week")).toMatchObject({ kind: "coming_up" });
    expect(intent("how much did I spend on food last month")).toMatchObject({ kind: "spending" });
    expect(intent("can I afford $900 for a trip in March")).toMatchObject({ kind: "afford" });
    // Taxes owed are a tax question.
    expect(intent("how much do I owe in taxes")).toMatchObject({ kind: "tax" });
  });
});
