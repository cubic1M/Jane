import { describe, expect, it } from "vitest";
import { checkGuardrails, type GuardrailProfile } from "./guardrails";

// Softer picks than an instruction ("the safer bet is VOO"), what to put on a W-4, claiming a credit
// and holding back from a collector. They stop on a real account (the standard profile) under
// Anthropic's Usage Policy from Nov 12, 2026; the legal one stops in demo advice too (CLAUDE.md,
// step 98). The chat's tenth round (11-12) found these got through.
const issues = (text: string, profile: GuardrailProfile) => {
  const check = checkGuardrails(text, [], undefined, profile);
  return check.ok ? [] : check.issues;
};
const advice = (text: string) =>
  issues(text, "standard").some((i) => i === "investment_advice" || i === "tax_or_legal_advice");

const PICKS = [
  "The safer bet is VOO.",
  "VOO is the stronger pick of the three.",
  "Trimming your Acme Corp stake would cut your risk.",
];
const TAX = [
  "You qualify for the earned income credit, so claim it.",
  "Put 0 on line 4(c) of your W-4.",
  "Set your W-4 to single with no dependents.",
];
const LEGAL = ["Don't pay the collector until they send validation."];

describe("softer advice, on a real account", () => {
  it.each([...PICKS, ...TAX, ...LEGAL])("stops %j", (text) => {
    expect(advice(text)).toBe(true);
  });

  it.each(LEGAL)("stops %j in demo advice too", (text) => {
    expect(issues(text, "demo_advice")).toContain("tax_or_legal_advice");
  });

  it.each([
    "I can't advise on investments here, and no one can say whether now is a good time.",
    "The IRS's Tax Withholding Estimator shows what to put on a new W-4.",
    "A collector must send a validation notice within five days of first contact.",
    "The biggest leak is Planet Fitness at $49.00 a month.",
    "Your best bet for the trip is the cheaper flight.",
    "Selling your stake in the car to your brother is between you two.",
  ])("lets %j through", (text) => {
    expect(advice(text)).toBe(false);
  });
});
