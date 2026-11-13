import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 21 (11-13): dispute rights under laws the rules didn't name, a legal deadline, a
// benefit someone definitely gets, what isn't taxed for this person, and a 403(b).
const amounts = [120000, 60000, 29000, 50000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("legal rights and benefits, on any account", () => {
  it.each([
    "Under the FCBA you have 60 days to dispute it.",
    "Under Reg E the bank has to refund you within 10 days.",
    "The EFTA protects you here.",
    "Federal law limits your liability.",
    "By law they must investigate within 30 days.",
    "You have 30 days to dispute the debt with the collector.",
    "You qualify for SNAP.",
    "You're eligible for Medicaid.",
    "You qualify for unemployment, so apply today.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "You may qualify for Lifeline; here's the link.",
    "Your SNAP deposit was $290.00.",
    "You can dispute a charge from your card's app.",
    "You have 30 days left on the Costco return window.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});

describe("tax and retirement on a real account", () => {
  it.each([
    "Venmo payments under $600 aren't taxable.",
    "Your scholarship isn't taxable.",
    "Gifts under $19,000 aren't taxed.",
    "Withdraw from your 403(b) early.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each(["Your scholarship of $500.00 posted Nov 1.", "Your tips came to $600.00 in October."])(
    "lets %s through",
    (text) => {
      expect(real(text).ok).toBe(true);
    },
  );
});
