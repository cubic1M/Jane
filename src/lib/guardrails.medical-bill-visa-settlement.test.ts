import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 35 (11-14): gold as a safe haven, a bonus "taxed at 22%", medical bills and
// collections, wills, visas, what an employer is required to do, signing a settlement, and
// promises about rates, housing, a bill forgiven, a car's value and fees.
const amounts = [9000, 1549, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("picks and tax on a real account", () => {
  it.each([
    "Gold is a safe haven; buy some.",
    "Your bonus is taxed at 22%.",
    "Gains are taxed at a lower rate.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each([
    "Your bonus of $400.00 landed Nov 3.",
    "Your Nvidia GeForce Now subscription is $15.49 a month.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("legal calls on any account", () => {
  it.each([
    "You don't have to pay that medical bill.",
    "The hospital can't send it to collections.",
    "You don't need a will.",
    "You don't need a lawyer for this.",
    "Your visa lets you work part time.",
    "They're required to give you a final paycheck within 72 hours.",
    "Your employer is required to pay overtime.",
    "Sign the settlement.",
    "Don't sign the non-compete.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "You don't need to pay the hospital bill until Nov 20.",
    "Your Visa lets you earn 2% back on groceries.",
    "Your settlement of $90.00 landed Nov 3.",
    "Sign in to see your statement.",
    "You don't need a new card for this.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});

describe("promises on any account", () => {
  it.each([
    "Interest rates will go down next year.",
    "Mortgage rates are going to keep falling.",
    "Housing will crash next year.",
    "A recession is coming.",
    "Your medical bill will be forgiven.",
    "Your car will hold its value.",
    "You'll never pay a fee again.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "Your rate will go up to 29.99% after the promo ends Mar 1.",
    "Your bill of $90.00 will be paid Nov 3.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});
