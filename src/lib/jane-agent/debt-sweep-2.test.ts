import { describe, expect, it } from "vitest";
import { debtBook, type DebtAccountInput } from "@/insights/debts";
import { decisionIdFor } from "./debt-decide";
import { debtDetailReply, debtsReply } from "./debt-replies";
import { parseDebtIntent } from "./debt-intents";
import { parseIntent } from "./intents";

// CodeRabbit part 2 (root-04 minors): debt questions routed to the answer that was asked for.
const AS_OF = "2027-01-15";
const intent = (text: string) => parseIntent(text, AS_OF);

describe("debt questions, routed", () => {
  it("counts the year in a credit goal's deadline", () => {
    expect(intent("I need a 740 credit score by June 2028")).toMatchObject({
      kind: "credit_goal",
      targetScore: 740,
      months: 17,
    });
    // A month alone is its next one.
    expect(intent("I need a 740 credit score by June")).toMatchObject({ months: 5 });
  });

  it("takes the score the goal names, not the one the person has", () => {
    expect(intent("my credit score is 620 and I want to reach 740 in 6 months")).toMatchObject({
      kind: "credit_goal",
      targetScore: 740,
      months: 6,
    });
    expect(intent("I need a 740 credit score in 6 months")).toMatchObject({ targetScore: 740 });
  });

  it("answers 'should I get a payday loan?' as the decision, history as the history", () => {
    expect(parseDebtIntent("should i get a payday loan?", null, AS_OF)).toEqual({
      kind: "debt_decision",
      which: "payday_loan",
    });
    expect(parseDebtIntent("how much have payday loans cost me?", null, AS_OF)).toEqual({
      kind: "costly_borrowing",
    });
  });

  // CodeRabbit #2293: past tense is the history, whatever the verb before "payday loan".
  it("keeps 'how much did getting a payday loan cost me' on the history", () => {
    expect(parseDebtIntent("how much did getting a payday loan cost me?", null, AS_OF)).toEqual({
      kind: "costly_borrowing",
    });
    expect(parseDebtIntent("should i get a payday loan?", null, AS_OF)).toEqual({
      kind: "debt_decision",
      which: "payday_loan",
    });
    // CodeRabbit #2293: "have" in a condition is not a question about the past.
    expect(
      parseDebtIntent("should i get a payday loan if i have no savings?", null, AS_OF),
    ).toEqual({ kind: "debt_decision", which: "payday_loan" });
    expect(
      parseDebtIntent(
        "should i get a payday loan if i have no savings and it will cost $100?",
        null,
        AS_OF,
      ),
    ).toEqual({ kind: "debt_decision", which: "payday_loan" });
  });

  it("reaches the monthly credit answer through the public parser, not 'what did you check'", () => {
    expect(intent("what did you check on my credit this month?")).toEqual({
      kind: "credit_monthly",
    });
    expect(intent("what did you check")).toEqual({ kind: "checked" });
  });

  it("reads a bare GAP on a car loan", () => {
    expect(intent("do i have gap on my car loan?")).toEqual({ kind: "car_loan" });
  });

  it("reads what was checked on credit this month", () => {
    expect(parseDebtIntent("what did you check on my credit this month?", null, AS_OF)).toEqual({
      kind: "credit_monthly",
    });
    expect(parseDebtIntent("yearly debt review", null, AS_OF)).toEqual({ kind: "debt_review" });
  });

  it("sends a mortgage balance or rate to that debt", () => {
    expect(intent("what's my mortgage balance?")).toEqual({
      kind: "debt_detail",
      target: "mortgage",
    });
    expect(intent("what's my mortgage rate?")).toEqual({ kind: "debt_detail", target: "mortgage" });
    expect(intent("tell me about my mortgage")).toEqual({ kind: "mortgage" });
  });

  it("does not answer a past year's interest with this year's", () => {
    expect(
      parseDebtIntent("how much did i pay in credit card interest in 2024?", null, AS_OF),
    ).toBeNull();
    expect(intent("how much credit card interest have i paid in 2027?")).toEqual({
      kind: "card_interest",
      thisYear: true,
    });
  });

  it("sends a student loan on the pay-off-or-invest path to its own answer", () => {
    expect(decisionIdFor("payoff_or_invest", "pay off the student loan or invest")).toBe(
      "student_early",
    );
    expect(decisionIdFor("payoff_or_invest", "pay off my card or invest")).toBe("pay_or_invest");
  });
});

const l = (over: Partial<NonNullable<DebtAccountInput["liability"]>>) => ({
  aprBps: null,
  rateType: null,
  minimumPaymentCents: null,
  nextPaymentDueDate: null,
  payoffDate: null,
  isOverdue: null,
  pastDueCents: null,
  description: null,
  ...over,
});
const CAR: DebtAccountInput = {
  id: "car",
  name: "Demo Car Loan",
  mask: "0006",
  type: "loan",
  subtype: "auto",
  currentBalanceCents: 1_802_000,
  liability: l({ aprBps: 690, nextPaymentDueDate: new Date("2027-01-28") }),
};
const CARD_ZERO: DebtAccountInput = {
  id: "card",
  name: "Demo Credit Card",
  mask: "0003",
  type: "credit",
  subtype: "credit card",
  currentBalanceCents: 0,
  liability: l({ aprBps: 2299 }),
};
const LOAN_UNKNOWN: DebtAccountInput = {
  id: "student",
  name: "Demo Student Loan",
  mask: "0009",
  type: "loan",
  subtype: "student",
  currentBalanceCents: null,
  liability: l({ aprBps: 500 }),
};

describe("debt answers, said as far as they are known", () => {
  it("gives a due date when the payment amount is not known", () => {
    const book = debtBook({ accounts: [CAR], plans: [], typed: [] }, AS_OF);
    expect(debtDetailReply("car", book).body).toMatch(
      /The next payment is due Jan 28; I don't know the amount yet\./,
    );
  });

  it("says the total is what is known when one balance is missing", () => {
    const book = debtBook({ accounts: [CARD_ZERO, LOAN_UNKNOWN], plans: [], typed: [] }, AS_OF);
    const body = debtsReply(book).body;
    expect(body).toMatch(/You owe \$0\.00 on 1 card that I can see/);
    expect(body).toMatch(/I can't see what you owe on Demo Student Loan/);
  });
});
