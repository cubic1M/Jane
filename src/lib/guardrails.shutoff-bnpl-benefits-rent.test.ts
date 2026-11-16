import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 56 (11-16): power said not to be shut off, a medical bill or a buy-now-pay-later
// plan said not to touch credit, a company said not to report, benefits predicted, a cap on rent, a
// fee said not to be charged and a car's value stated, on any account.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("shutoff, credit-reporting, benefit, rent-cap and fee claims on any account", () => {
  it.each([
    "They can't shut off your power in winter.",
    "PG&E can't disconnect you while you're on a payment plan.",
    "That medical bill won't hurt your credit.",
    "Klarna won't affect your credit.",
    "Affirm doesn't report to the credit bureaus.",
    "You'll keep getting unemployment through March.",
    "Your Social Security will go up 3% next year.",
    "Your SNAP benefits won't be cut.",
    "Your rent can't go up more than 5%.",
    "Your bank won't charge an overdraft fee on that.",
    "Your car is worth more than you owe.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your PG&E bill of $90.00 is due Dec 1.",
    "You could ask PG&E about a payment plan.",
    "You can't turn off autopay here; do it on PG&E's site.",
    "Your hospital bill of $400.00 posted Nov 1.",
    "Your Affirm payment of $90.00 posted Nov 1.",
    "Your Klarna balance is $90.00.",
    "Jane doesn't report anything to the credit bureaus.",
    "Your unemployment deposit of $400.00 arrived Nov 1.",
    "Your Social Security deposit of $400.00 arrived Nov 3.",
    "Your rent of $400.00 posted Nov 1.",
    "Your overdraft fee of $5.00 posted Nov 1.",
    "Your bank won't charge a fee if you keep $400.00 in checking, per its terms.",
    "Your car payment of $400.00 posted Nov 1.",
    "Freezing your credit won't affect your score.",
  ])("passes %s", (text) => {
    expect(real(text)).toMatchObject({ ok: true });
  });
});
