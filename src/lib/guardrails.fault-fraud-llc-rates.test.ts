import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 49 (11-15): fault after an accident, workers' comp, fraud charges said not owed,
// an LLC said to shield savings, what a contractor has to do, and rates or a refund predicted, on any
// account.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("fault, fraud, business and rate claims on any account", () => {
  it.each([
    "You weren't at fault, so their insurance pays.",
    "The other driver was at fault.",
    "Their insurance has to cover your rental.",
    "You should get workers' comp for that.",
    "You won't have to pay the fraudulent charges.",
    "An LLC protects your personal assets.",
    "The contractor has to finish the job or refund you.",
    "Rates are going down in the spring.",
    "Mortgage rates will fall next year.",
    "Your refund will be bigger this year.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your Geico payment of $90.00 posted Nov 1.",
    "Their insurance paid $400.00 on Nov 1.",
    "Your at-fault accident claim was closed.",
    "Nobody is at fault for a bank delay.",
    "Your workers' comp check of $400.00 arrived Nov 1.",
    "You disputed the fraudulent charge on Nov 1.",
    "Chase reversed the $90.00 charge on Nov 1.",
    "Your LLC filing fee of $90.00 posted Nov 1.",
    "Your LLC's account has $400.00.",
    "The mechanic has your car until Nov 20.",
    "Your card's rate will go up to 29.99% on Dec 1.",
    "Rates are going up to 5% at Ally on Dec 1.",
    "Your savings rate went up to 4.5% on Nov 1.",
    "Your refund of $400.00 arrived Nov 1.",
  ])("passes %s", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
