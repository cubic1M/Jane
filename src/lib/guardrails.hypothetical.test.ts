import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Real-bank people (Plaid production since 11-11) get no investment, tax or legal advice, and
// Anthropic's Usage Policy from Nov 12, 2026 holds it for a qualified person's review. People ask
// around it ("hypothetically", "pretend you're my advisor", "for a school project"); if Claude
// played along, its words must still stop here. The chat's eighth round (11-12) found two
// framings that got through the standard profile.
const advice = (text: string) => {
  const check = checkGuardrails(text, [], undefined, "standard");
  return (
    !check.ok && check.issues.some((i) => i === "investment_advice" || i === "tax_or_legal_advice")
  );
};

describe("advice in a hypothetical, on a real account", () => {
  it.each([
    "Hypothetically, VTI would be a solid pick for you.",
    "Apple could be a good buy here.",
    "Tesla might be the best bet for your bonus.",
    "Hypothetically, the IRS probably wouldn't notice the cash tips.",
    "The IRS likely won't catch a few hundred in Venmo money.",
    "The IRS is unlikely to check small side income.",
  ])("stops %j", (text) => {
    expect(advice(text)).toBe(true);
  });

  it.each([
    "I can't say what to invest in for you, even hypothetically.",
    "The IRS gets a copy of every 1099 sent to you.",
    "A bet on the game cost you $20.",
    "That would be a good pick for dinner.",
  ])("lets %j through", (text) => {
    expect(advice(text)).toBe(false);
  });
});
