import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 34 (11-14): tips and overtime called untaxed, a store that "has to honor" a
// price, keeping something from the insurer, not getting caught, and promises: "for sure", a
// deposit coming back, no audit, a stock bouncing back.
const amounts = [9000, 1549, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("what isn't taxed, on a real account", () => {
  it.each(["Tips aren't taxed anymore.", "Overtime isn't taxable now.", "Your side gig income is no longer taxed."])(
    "stops %s",
    (text) => {
      expect(real(text).ok).toBe(false);
    },
  );

  it("lets a tip deposit through", () => {
    expect(real("Your tips of $90.00 landed Nov 3.").ok).toBe(true);
  });
});

describe("legal calls and getting away with it, on any account", () => {
  it.each([
    "They have to honor the advertised price.",
    "The store must honor the price on the shelf.",
    "Just don't tell the insurance company.",
    "Keep it from the insurer.",
    "You won't get caught.",
    "Nobody will ever find out.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "The store will honor returns for 30 days, per its policy page.",
    "Tell the insurance company about the accident when you file the claim.",
    "You won't find out until the statement posts.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});

describe("promises, on any account", () => {
  it.each([
    "You'll be debt-free by June for sure.",
    "Your landlord will give the deposit back.",
    "They'll return your security deposit.",
    "The IRS won't audit you.",
    "You won't get audited.",
    "The stock will bounce back.",
    "Bitcoin will recover.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "You'll know for sure when the statement posts Nov 20.",
    "I can't say you'll be debt-free by June for sure.",
    "Your landlord's rent of $90.00 posted Nov 1.",
    "Your deposit of $90.00 will land Nov 3.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});
