import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 24 (11-13): a pick as "something like VOO" or a numbered list, what an HOA or a
// contract can do by law, stopping HOA dues, and a promised score or "always works".
const amounts = [30000, 25000, 200000, 5000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("picks on a real account", () => {
  it.each(["Something like VOO would do.", "1. VOO 2. VTI 3. QQQ", "1) VTI, 2) VXUS"])(
    "stops %s",
    (text) => {
      expect(real(text).ok).toBe(false);
    },
  );

  it.each([
    "1. Netflix 2. Hulu 3. Max",
    "1. ATM fees 2. APR",
    "Something like a $50.00 weekly cap would do.",
    "Consider canceling Hulu.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("legal claims and promises, on any account", () => {
  it.each([
    "Your HOA can't fine you for that.",
    "That clause isn't enforceable.",
    "Just stop paying the HOA.",
    "Sign it; it's a standard contract.",
    "Your score will hit 750 by spring.",
    "This always works.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "Your HOA dues are $300.00 a month.",
    "Your contract with Verizon ends in March.",
    "Stop paying for Hulu to save $50.00.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});
