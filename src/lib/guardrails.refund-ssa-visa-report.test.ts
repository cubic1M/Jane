import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 51 (11-16): a named company's refund promised, Social Security said to run out,
// what a visa lets someone do, medical debt said to stay off a report and safety stated, on any
// account.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("refund, Social Security, visa and report claims on any account", () => {
  it.each([
    "Venmo will refund you for the scam.",
    "PayPal will reimburse you.",
    "Zelle will give you your money back.",
    "Social Security will run out before you retire.",
    "Social Security won't be there for you.",
    "On an F-1 visa you can work 20 hours a week.",
    "F-1 students can work on campus.",
    "With DACA you can get a federal loan.",
    "Under OPT you may work for any employer.",
    "Medical debt won't show on your credit report.",
    "Medical bills under $500 won't show up on your credit report.",
    "Late payments won't stay on your report.",
    "Your identity is protected now.",
    "Your money is safe.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your PayPal refund of $15.49 posted Nov 1.",
    "Chase refunded you $5.00 on Nov 1.",
    "Ask Venmo if it can refund you.",
    "With your Visa you can pay at the pump.",
    "Your Visa card lets you tap to pay.",
    "Your OPT application fee of $400.00 posted Nov 1.",
    "Your USCIS fee of $400.00 posted Nov 1.",
    "Your Social Security deposit of $400.00 arrived Nov 1.",
    "Social Security deposits arrive on the 3rd.",
    "Your medical bill of $400.00 is due Dec 1.",
    "Your card is locked as of Nov 1.",
    "Your money is safe to spend up to $400.00.",
    "Your Secure Storage charge was $90.00.",
  ])("passes %s", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
