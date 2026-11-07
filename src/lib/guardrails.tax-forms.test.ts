import { describe, expect, it } from "vitest";
import { checkGuardrails, type GuardrailProfile } from "./guardrails";

// Jane now reads a person's own W-2s, 1099s and IRS transcript, and knows each state's estimated
// tax. The chat's fourth policy round (11-06) found Claude could still tell a real account to
// leave a form off or skip a state payment: advice on the person's own taxes, which Anthropic's
// Usage Policy from Nov 12, 2026 holds for a qualified person's review. What a form shows, and
// when a payment is due, stay facts.
const advice = (text: string, profile: GuardrailProfile = "standard") => {
  const check = checkGuardrails(text, [], undefined, profile);
  return !check.ok && check.issues.includes("tax_or_legal_advice");
};

const MOVES = [
  "Skip the state estimate this time.",
  "Don't pay the state estimate in January.",
  "You don't need to report the 1099-K.",
  "You don't have to include that 1099-NEC.",
  "Leave the W-2 off.",
  "Ignore the 1099-K from PayPal.",
];

describe("tax forms and state estimates on a real account", () => {
  it.each(MOVES)("stops %j", (text) => {
    expect(advice(text)).toBe(true);
  });

  it.each([
    "Your 1099-NEC shows $8,000.00 from Lucid Design.",
    "Box 1 of your W-2 shows $68,000.00 in wages.",
    "California's estimated tax has no September payment.",
    "The next state estimated payment is due January 15.",
    "Code 846 on a transcript means a refund was issued.",
    "PayPal sends a 1099-K when payments pass the reporting threshold.",
    "Skip the gym this month and you'd keep $40.",
  ])("lets %j through", (text) => {
    expect(advice(text)).toBe(false);
  });

  it.each(MOVES)("still lets demo advice say %j, labelled", (text) => {
    expect(advice(text, "demo_advice")).toBe(false);
  });
});
