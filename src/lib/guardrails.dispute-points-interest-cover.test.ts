import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 54 (11-16): a dispute's outcome or timing, a transfer said to come back, a named
// company's duty, points that never expire, a company that won't charge interest, payments said to
// be paused or skippable, a price match, a charge said to drop off or not be made, interest forgiven
// and coverage stated, on any account.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("dispute, transfer, rewards, interest and coverage claims on any account", () => {
  it.each([
    "The dispute will be resolved in 10 days.",
    "Chase will side with you on the dispute.",
    "The bank will reverse the Zelle payment.",
    "Delta has to refund your ticket.",
    "Your carrier has to unlock your phone.",
    "Your bank can't charge you an overdraft fee on a debit card.",
    "Your points never expire.",
    "Your points won't expire.",
    "Affirm won't charge you interest.",
    "Klarna never charges interest.",
    "Your student loan payments are paused.",
    "You can skip a payment without penalty.",
    "Target will price match it.",
    "The charge will drop off once you dispute it.",
    "You won't be charged for the return.",
    "Your interest will be forgiven if you pay it off in time.",
    "Your extended warranty will cover the repair.",
    "You're covered by purchase protection.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your dispute of the $15.49 charge was opened Nov 1.",
    "Your statement says the dispute is under review.",
    "Ask Chase how long the dispute takes.",
    "Ask Delta whether the flight qualifies for a refund.",
    "Your Zelle payment of $90.00 to Sam posted Nov 1.",
    "Your points balance is 1,200, per the statement.",
    "Your Klarna plan charges no interest, per its terms.",
    "Your Affirm plan doesn't charge interest, per its terms.",
    "Your loan servicer's letter says payments resume Dec 1.",
    "You can ask Target whether they price match.",
    "Ask whether Target will price match it.",
    "The pending charge will drop off in a few days.",
    "Jane has to see a second statement before it can tell.",
    "You earned $5.00 cash back on Nov 1.",
  ])("passes %s", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
