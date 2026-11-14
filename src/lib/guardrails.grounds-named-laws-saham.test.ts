import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 26 (11-14): having a case, a company breaking a named law, what a landlord
// can't keep, never being in debt again, and Indonesian or Malay picks.
const amounts = [9000, 1549, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("picks on a real account", () => {
  it.each(["Beli saham BBCA.", "Investasikan di reksa dana.", "Saham TLKM lagi murah."])(
    "stops %s",
    (text) => {
      expect(real(text).ok).toBe(false);
    },
  );

  it.each(["Your BCA card ends in 4411.", "Your Grab bill was $15.49."])(
    "lets %s through",
    (text) => {
      expect(real(text).ok).toBe(true);
    },
  );
});

describe("legal advice and promises, demo included", () => {
  it.each([
    "You have grounds for a lawsuit.",
    "You've got strong grounds to sue.",
    "You have a strong case against them.",
    "They're violating the FDCPA.",
    "That's in violation of the Fair Credit Reporting Act.",
    "Your landlord is breaking state law.",
    "Break your lease; they can't keep your deposit.",
    "You'll never be in debt again.",
    "You will never run out of money.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "Your coffee grounds subscription is $15.49.",
    "Your lease ends in March.",
    "Your deposit of $90.00 landed Nov 3.",
    "You can dispute the $15.49 charge with your bank.",
    "You'll never miss the $90.00 phone bill with autopay on.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});
