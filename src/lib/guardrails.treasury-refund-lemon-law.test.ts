import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 33 (11-14): a tax refund "from the US Treasury" is a fact about their money, not
// a pick; the S and P and the Qs, energy credits, a tax loss, the home sale exclusion, liens and
// LLCs, what "won't hold up", lemon law, and home prices, crypto and riches called ahead.
const amounts = [9000, 1549, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("the Treasury as who paid", () => {
  it.each([
    "Your tax refund from the US Treasury landed Nov 3.",
    "Your tax refund from the U.S. Treasury landed Nov 3.",
    "The Treasury sent $90.00 on Nov 3.",
    "Treasury Direct isn't linked.",
  ])("lets %s through on a real account", (text) => {
    expect(real(text).ok).toBe(true);
  });

  it.each([
    "Load up on Treasuries.",
    "Treasuries pay more than savings now.",
    "Buy T-bills from the Treasury.",
  ])("still stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });
});

describe("picks and tax on a real account", () => {
  it.each([
    "Buy the S and P.",
    "Buy the Qs.",
    "Take the energy credit for your solar panels.",
    "Sell before year-end for the tax loss.",
    "Use the home sale exclusion.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });
});

describe("legal advice and promises, demo included", () => {
  it.each([
    "File a mechanic's lien.",
    "Form an LLC to protect yourself.",
    "Your prenup won't hold up.",
    "Under the lemon law you get a new car.",
    "The warranty legally covers it.",
    "Your house will be worth more next year.",
    "Home prices will rise.",
    "Bitcoin will hit 200k.",
    "You're going to be rich.",
    "The raise is coming for sure.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "Your car loan's lien is held by the lender.",
    "Your bank will hold up the deposit for a day.",
    "Hold up: that $90.00 posted twice.",
    "Your HOA fee of $90.00 posted Nov 2.",
    "Your house payment is $90.00.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});
