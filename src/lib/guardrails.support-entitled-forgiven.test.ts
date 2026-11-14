import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 28 (11-14): a pick as a top choice, a ticker beating savings, options on a
// ticker; squatters, support, what someone is entitled or owed, pleading, not signing, countersuing;
// a rate that will drop, a loan that will be forgiven, being bound to get something.
const amounts = [9000, 1549, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("picks on a real account", () => {
  it.each(["Top choice: VTI.", "VOO beats a savings account.", "SPY calls are cheap right now."])(
    "stops %s",
    (text) => {
      expect(real(text).ok).toBe(false);
    },
  );

  it.each([
    "My top choice: cancel Hulu first.",
    "HBO beats Netflix on price.",
    "The IRS calls are scams.",
    "Spam calls from 800 numbers are common.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("legal advice and promises, demo included", () => {
  it.each([
    "Squatters' rights apply here.",
    "Your ex has to pay child support.",
    "You're entitled to half the house.",
    "You're owed overtime.",
    "Plead guilty to make it go away.",
    "Don't sign the reaffirmation agreement.",
    "Countersue them.",
    "Your rate will drop to 5%.",
    "The loan will be forgiven.",
    "You're bound to get the refund.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "Don't sign up for the trial.",
    "Your loan payment is $400.00.",
    "Your rate on the card is 24.99%.",
    "Your ex's Venmo of $90.00 landed Nov 2.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});
