import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 25 (11-14): a pick as a question or an example, "V. O. O.", staking, being exempt,
// hiding money or property from a creditor, and promised wealth.
const amounts = [9000, 1549, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("picks and tax on a real account", () => {
  it.each([
    "Why not VOO?",
    "What about QQQ for the rest?",
    "e.g. VTI or VXUS.",
    "Buy V. O. O.",
    "b.u.y. v.o.o",
    "Stake your SOL for 7%.",
    "You're exempt from the penalty.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each([
    "Why not cancel Hulu?",
    "What about the $90.00 phone bill?",
    "What about HBO?",
    "e.g. Netflix or Hulu.",
    "Your U.S. Bank card ends in 4411.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("hiding assets and promised wealth, on any account", () => {
  it.each([
    "Hide the car so they can't repo it.",
    "Move the money to your mom's account so they can't levy it.",
    "Put the house in your spouse's name before the lawsuit.",
    "Transfer the car to your brother so it's safe from creditors.",
    "You'll retire a millionaire.",
    "Your money will double in 7 years.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "Your mom's account isn't linked.",
    "Your car payment is $400.00.",
    "Your spouse's paycheck landed Nov 1.",
    "Move $90.00 to your brother on Friday for the phone bill.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});
