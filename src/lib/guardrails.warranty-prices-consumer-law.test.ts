import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 42 (11-15): consumer-law claims, a warranty promised to cover something and
// prices predicted, on any account; and a designer's subscriptions (Adobe Stock, a portfolio site)
// on a real account's statement.
const amounts = [500, 1549, 9000, 40000, 1299];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("claims and predictions on any account", () => {
  it.each([
    "Gift cards can't expire.",
    "They can't charge a restocking fee.",
    "Your warranty covers that.",
    "The price will drop on Black Friday.",
    "Airfare will go down next month.",
    "Gas prices will go up next month.",
    "Prices will be lower in January.",
    "Your security deposit has to be returned with interest.",
    "The Fair Debt Collection Practices Act says they must stop calling.",
    "The Fair Credit Reporting Act lets you remove it.",
    "Your insurer has to pay within 30 days.",
    "Your bank has to refund unauthorized charges.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your Adobe Stock subscription is $15.49 a month.",
    "Your Squarespace portfolio site renewal of $15.49 posted Nov 1.",
    "Your Adobe Portfolio plan is $15.49 a month.",
    "Spotify's price will go up to $12.99 on Dec 1.",
    "Your rent will go up $90.00 on Dec 1.",
    "Prices will probably drop after the holidays.",
    "Your Best Buy purchase of $90.00 posted Nov 2.",
    "Your AppleCare plan is $15.49 a month.",
    "Your deposit of $400.00 posted Nov 1.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });

  it.each(["Buy Adobe stock.", "Add to your portfolio."])("still blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
  });
});
