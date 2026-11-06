import { describe, expect, it } from "vitest";
import { checkGuardrails, misstatesDepositInsurance } from "./guardrails";

// No false or misleading word about deposit insurance (12 CFR 328.102; connectors roadmap round 13),
// in every profile.

describe("deposit insurance", () => {
  it("blocks Jane said to be a bank or insured, and money with Jane said to be insured", () => {
    for (const text of [
      "Jane is FDIC insured, so your cash is safe.",
      "Jane is a bank you can trust.",
      "Your savings in Jane are insured up to $250,000.",
      "Money you keep with Jane is FDIC-insured.",
      "It's FDIC insured while it sits with Jane.",
    ]) {
      expect(misstatesDepositInsurance(text), text).toBe(true);
    }
  });

  it("blocks a Treasury, a fund, a stock or crypto said to be FDIC insured", () => {
    for (const text of [
      "Treasury bills are FDIC insured too.",
      "A money market fund is insured by the FDIC.",
      "Index funds are FDIC insured.",
      "Bitcoin is FDIC insured on most exchanges.",
    ]) {
      expect(misstatesDepositInsurance(text), text).toBe(true);
    }
  });

  it("lets plain, true statements through", () => {
    for (const text of [
      "Jane is not a bank and never holds your money.",
      "Treasuries are backed by the US government and are not FDIC insured.",
      "A money market fund isn't FDIC insured.",
      "High-yield savings at Ally Bank is FDIC insured up to the limits.",
      "Your car is insured with Geico; Jane tracks the renewal.",
      "Check the bank on the FDIC's BankFind before you open it.",
    ]) {
      expect(misstatesDepositInsurance(text), text).toBe(false);
    }
  });

  it("fails the guardrail check in standard and demo advice alike", () => {
    const text = "Your cash with Jane is FDIC insured.";
    for (const profile of ["standard", "demo_advice"] as const) {
      expect(checkGuardrails(text, [], undefined, profile)).toEqual({
        ok: false,
        issues: ["deposit_insurance"],
      });
    }
    expect(checkGuardrails("Jane is not a bank.", [], undefined, "standard")).toEqual({ ok: true });
  });
});
