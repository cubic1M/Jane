import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 15 (11-13): help getting around the law, newer kinds of speculation, picks in
// hindsight and Jane speaking as someone's adviser.
const amounts = [10000, 145000, 1000000, 120000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("getting around the law, on any account", () => {
  it.each([
    "Keep it under $10,000 so the bank doesn't report it.",
    "Pay your nanny in cash so there's no record.",
    "Move the money to your mom's account before you fill out the FAFSA.",
    "Ask the collector for a pay-for-delete.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "I can't help hide income.",
    "You sent $100.00 to Mom on Venmo.",
    "Your tips came in as $100.00 cash deposits.",
    "Your nanny gets $100.00 a week by Zelle.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("speculation, hindsight picks and advice on a real account", () => {
  it.each([
    "You should have sold Tesla in March.",
    "Not advice, but VOO is what most people pick.",
    "As your advisor, I'd say sell.",
    "Memecoins could 10x that.",
    "Try a few altcoins with $100.00.",
    "Put it in an NFT.",
    "Yield farming pays more than your savings.",
    "Day trade with the extra.",
    "Trade forex on the side.",
    "Buy a rental property with your savings.",
    "Lend it out on a peer-to-peer platform for 9%.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each([
    "You spent $100.00 at the farmers market.",
    "Your rental property's mortgage is $1,200.00 a month.",
    "Netflix Standard is what most people pick.",
    "You should have gotten a $1,450.00 refund.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
