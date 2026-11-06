import { describe, expect, it } from "vitest";
import { misstatesDepositInsurance } from "./guardrails";

// Deposit insurance (12 CFR 328.102) said in other words than "FDIC insured": protected by, backed
// by, carrying FDIC insurance, or a negation that isn't one. And true sentences that only mention
// Jane near the word "insured" stay allowed (./guardrails-fdic.test.ts has the first set).

describe("deposit insurance, other phrasings", () => {
  it("blocks the same false claim in other words", () => {
    for (const text of [
      "Your money at Jane is protected by the FDIC.",
      "Treasuries carry FDIC insurance up to $250,000.",
      "Your T-bills: FDIC insured.",
      "Treasuries are no less FDIC insured than deposits.",
      "Crypto held here is FDIC-backed.",
      "Cash you move through Jane has FDIC coverage.",
    ]) {
      expect(misstatesDepositInsurance(text), text).toBe(true);
    }
  });

  it("lets true sentences that mention Jane near 'insured' through", () => {
    for (const text of [
      "Your Ally savings, which you can see in Jane, are FDIC insured.",
      "With Jane you can compare insured savings accounts.",
      "Moving cash from a money market fund to a savings account with FDIC insurance adds protection.",
      "Stocks aren't FDIC insured; your bank savings are.",
    ]) {
      expect(misstatesDepositInsurance(text), text).toBe(false);
    }
  });
});
