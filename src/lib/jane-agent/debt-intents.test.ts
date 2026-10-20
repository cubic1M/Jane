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

  it("reads buying a car: what's affordable, preapprovals, and a dealer's offer", () => {
    expect(intent("how much car can I afford")).toEqual({ kind: "car_afford", priceCents: null });
    expect(intent("can I afford a $30,000 car")).toEqual({
      kind: "car_afford",
      priceCents: 3_000_000,
    });
    expect(intent("compare car loan preapproval offers")).toEqual({
      kind: "car_afford",
      priceCents: null,
    });
    expect(intent("the dealer offered 7.9% for 72 months on $28,000")).toEqual({
      kind: "car_dealer",
      aprBps: 790,
      termMonths: 72,
      priceCents: 2_800_000,
    });
    // Debt questions about a car already owned stay debt questions.
    expect(intent("how much do I owe on my car")).toEqual({ kind: "debt_detail", target: "car" });
  });

  it("reads buying a home, but not a mortgage already owned or home insurance", () => {
    expect(intent("how much house can I afford")).toEqual({
      kind: "home_afford",
      priceCents: null,
    });
    expect(intent("can I afford a $400,000 home")).toEqual({
      kind: "home_afford",
      priceCents: 40_000_000,
    });
    expect(intent("how much should I save for a down payment")).toEqual({
      kind: "home_afford",
      priceCents: null,
    });
    expect(intent("what are closing costs")).toEqual({ kind: "home_afford", priceCents: null });
    expect(intent("when does my home insurance renew")).not.toMatchObject({ kind: "home_afford" });
    expect(intent("when will my mortgage be paid off")).toMatchObject({ kind: "debt_detail" });
    expect(intent("can I afford $900 for a home repair")).not.toMatchObject({
      kind: "home_afford",
    });
  });

  it("reads medical bills, but not medical tax questions or insurance claims", () => {
    for (const text of [
      "I have a hospital bill I can't pay",
      "can you check my medical bills",
      "ask the dentist for an itemized bill",
      "financial assistance for my er bill",
    ]) {
      expect(intent(text), text).toEqual({ kind: "medical_bills" });
    }
    expect(intent("are my medical bills tax deductible")).not.toMatchObject({
      kind: "medical_bills",
    });
    expect(intent("file a claim for my doctor visit")).not.toMatchObject({ kind: "medical_bills" });
  });

  it("reads collections and credit report errors, but not taxes owed", () => {
    for (const text of [
      "there's a collection on my credit report",
      "a debt collector keeps calling me",
      "there is an error on my credit report",
      "how do I dispute something with the credit bureaus",
      "I need debt validation",
    ]) {
      expect(intent(text), text).toEqual({ kind: "report_fixes" });
    }
    expect(intent("what's my credit score")).toEqual({ kind: "credit_score" });
  });

  it("reads card interest, promotions and asking for a lower rate", () => {
    for (const text of [
      "how much interest am I paying on my cards",
      "how can I pay less interest on my credit cards",
      "when does my 0% promotion end",
      "what is deferred interest",
    ]) {
      expect(intent(text), text).toEqual({ kind: "card_interest" });
    }
    // A loan's or a transfer's interest is its own question.
    expect(intent("how much interest on my mortgage")).not.toMatchObject({ kind: "card_interest" });
    expect(intent("what's the rate on my credit card")).toEqual({
      kind: "debt_detail",
      target: "credit card",
    });
  });

  it("reads the long game on student loans: PSLF progress, recertifying, refinancing", () => {
    for (const text of [
      "how many PSLF payments have I made",
      "when will my PSLF be done",
      "when do I recertify my income-driven plan",
      "should I refinance my student loans",
      "is my forgiven student loan taxable",
    ]) {
      expect(intent(text), text).toEqual({ kind: "student_long" });
    }
    // The plan questions stay where they were.
    expect(intent("am I eligible for PSLF")).toEqual({ kind: "student_loans" });
  });

  it("reads money lent to or borrowed from family and friends, co-signing and shared debts", () => {
    for (const text of [
      "who owes me money",
      "did Sam pay me back",
      "money I lent my brother",
      "I owe my sister",
      "I co-signed a loan",
      "what are our shared debts",
    ]) {
      expect(intent(text), text).toEqual({ kind: "family_loans" });
    }
    // Plain debt questions stay debt questions.
    expect(intent("how much do I owe")).toEqual({ kind: "debts" });
  });

  it("reads a credit score needed by a date", () => {
    expect(intent("I need a 740 credit score for a mortgage in 6 months")).toEqual({
      kind: "credit_goal",
      targetScore: 740,
      months: 6,
      goalKind: "mortgage",
    });
    expect(intent("how do I get my score to 720 for a car by june")).toMatchObject({
      kind: "credit_goal",
      targetScore: 720,
      goalKind: "car",
    });
    expect(intent("what's my credit plan")).toMatchObject({
      kind: "credit_goal",
      targetScore: null,
    });
    // Asking the score itself, or a year with a number in it, isn't a goal.
    expect(intent("what's my credit score")).toEqual({ kind: "credit_score" });
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

  it("reads PMI's automatic end, an escrow check and a home project (spec step 228)", () => {
    for (const text of [
      "when does my PMI end by itself",
      "will my pmi drop off at 78%",
      "what's the original value rule for pmi",
    ]) {
      expect(intent(text), text).toEqual({
        kind: "home_equity",
        topic: "pmi",
        projectCents: null,
        years: null,
      });
    }
    for (const text of [
      "is my escrow too high",
      "is my escrow right for my tax and insurance bills",
      "am I overpaying into escrow",
      "can I get an escrow refund",
    ]) {
      expect(intent(text), text).toEqual({
        kind: "home_equity",
        topic: "escrow",
        projectCents: null,
        years: null,
      });
    }
    expect(intent("HELOC or cash-out refinance for a $40,000 kitchen")).toEqual({
      kind: "home_equity",
      topic: "project",
      projectCents: 4_000_000,
      years: null,
    });
    expect(intent("how should I pay for a $30,000 roof over 7 years")).toEqual({
      kind: "home_equity",
      topic: "project",
      projectCents: 3_000_000,
      years: 7,
    });
    // Plain PMI and escrow questions stay with step 115; tax questions stay tax.
    expect(intent("can I get rid of PMI")).toEqual({ kind: "mortgage" });
    expect(intent("did my escrow go up")).toEqual({ kind: "mortgage" });
    expect(intent("is my HELOC interest deductible")).not.toMatchObject({ kind: "home_equity" });
  });

  it("reads too much debt, settlement, bankruptcy and counseling (spec step 229)", () => {
    for (const text of [
      "I have too much debt",
      "I'm drowning in debt",
      "what are my options with my debt",
      "should I file for bankruptcy",
      "what about debt settlement",
      "tell me about a debt management plan",
      "is credit counseling worth it",
      "I can't keep up with my debts",
      "will bankruptcy forgive my taxes",
    ]) {
      expect(intent(text), text).toEqual({ kind: "debt_trouble" });
    }
    // A short month is the tight-money flow, not this one.
    expect(intent("money is tight this month")).toMatchObject({ kind: "tight_money" });
  });

  it("reads a request for the debt review (spec step 230)", () => {
    for (const text of [
      "do my yearly debt review",
      "give me a debt checkup",
      "annual credit review",
      "review my debts",
      "how are my debts doing",
      "go over my loans",
    ]) {
      expect(intent(text), text).toEqual({ kind: "debt_review" });
    }
    // What the autopilot does stays its own question.
    expect(intent("what do you do about my debts")).toEqual({ kind: "debt_autopilot" });
  });

  it("reads add-ons on a car loan (spec step 245)", () => {
    for (const text of [
      "can I cancel the extended warranty on my car loan",
      "do I have gap insurance on my car loan",
      "what dealer add-ons are in my loan",
      "car loan rates fell, should I refinance",
    ]) {
      expect(intent(text), text).toEqual({ kind: "car_loan" });
    }
  });

  it("reads recasting and extra money for the mortgage (spec step 246)", () => {
    expect(intent("I have $20,000, should I recast my mortgage")).toEqual({
      kind: "mortgage_money",
      lumpCents: 2_000_000,
      extraMonthlyCents: null,
    });
    expect(intent("should I put $500 a month toward my mortgage or invest it instead")).toEqual({
      kind: "mortgage_money",
      lumpCents: null,
      extraMonthlyCents: 50_000,
    });
    expect(intent("recast vs refinance")).toEqual({
      kind: "mortgage_money",
      lumpCents: null,
      extraMonthlyCents: null,
    });
    // The plain mortgage questions stay with step 115.
    expect(intent("can I get rid of PMI")).toEqual({ kind: "mortgage" });
    expect(intent("when will my mortgage be paid off")).toEqual({
      kind: "debt_detail",
      target: "mortgage",
    });
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
