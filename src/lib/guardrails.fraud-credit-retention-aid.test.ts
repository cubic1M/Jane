import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 55 (11-16): a fraud loss said to be covered, credit said to be built, a retention
// offer or partial refund promised, a hospital taking half, aid eligibility, a freeze said to stop
// identity theft, a Zelle payment said to be reversible, the IRS forgiving a penalty and crypto
// called safe, on any account.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("fraud, credit-building, retention, aid and crypto-safety claims on any account", () => {
  it.each([
    "You won't be held responsible for the fraudulent charges.",
    "Your bank will cover the fraud.",
    "Chase will make you whole.",
    "A secured card will build your credit in 6 months.",
    "Paying rent with a credit card builds your credit.",
    "Becoming an authorized user will add points to your score.",
    "Comcast will give you a retention discount.",
    "They'll give you a promo rate if you threaten to cancel.",
    "Netflix will refund the rest of the month.",
    "The hospital will take half if you pay in cash.",
    "You qualify for a Pell Grant.",
    "You're eligible for financial aid.",
    "A credit freeze will stop identity theft.",
    "Nobody can open a card in your name once it's frozen.",
    "Zelle payments can be reversed.",
    "The IRS will forgive the penalty.",
    "USDC is as safe as cash.",
    "Stablecoins are safe.",
    "Your crypto is insured.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Freezing your credit won't affect your score.",
    "A secured card can help build credit if it reports to the bureaus.",
    "Your credit freeze was placed on Nov 1, per your note.",
    "Ask Comcast whether they have a cheaper plan.",
    "You could ask the hospital for an itemized bill.",
    "Your Pell Grant deposit of $400.00 arrived Nov 1.",
    "Your secured card payment of $90.00 posted Nov 1.",
    "You reported the charge as fraud on Nov 1.",
    "Ask your bank how fraud claims work.",
    "Your Netflix charge of $15.49 posted Nov 1.",
    "Your Comcast bill of $90.00 posted Nov 1.",
    "Your hospital bill of $400.00 is due Dec 1.",
  ])("passes %s", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
