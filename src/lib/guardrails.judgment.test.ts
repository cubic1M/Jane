import { describe, expect, it } from "vitest";
import { checkGuardrails, type GuardrailProfile } from "./guardrails";

// Advice put as a judgment instead of an instruction ("holding makes more sense", "the statute of
// limitations has run out"). Investment and tax picks are held for a qualified person's review by
// Anthropic's Usage Policy from Nov 12, 2026 and stop on a real account (the standard profile);
// legal claims stop in demo advice too (CLAUDE.md, step 98). The chat's ninth round (11-12)
// found these got through.
const issues = (text: string, profile: GuardrailProfile) => {
  const check = checkGuardrails(text, [], undefined, profile);
  return check.ok ? [] : check.issues;
};
const advice = (text: string) =>
  issues(text, "standard").some((i) => i === "investment_advice" || i === "tax_or_legal_advice");

const PICKS = [
  "Holding makes more sense than selling right now.",
  "Keeping them makes more sense.",
  "Selling now would lock in your loss, so wait.",
  "Traditional wins for you this year.",
  "Moving half into VTI would balance you out.",
  "Claiming your mom saves you more.",
];
const LEGAL = [
  "You don't have to pay it blindly; make them prove the debt is yours.",
  "Legally they can't garnish your wages for that.",
  "The statute of limitations has run out on that debt.",
];

describe("advice as a judgment, on a real account", () => {
  it.each([...PICKS, ...LEGAL])("stops %j", (text) => {
    expect(advice(text)).toBe(true);
  });

  it.each(LEGAL)("stops %j in demo advice too", (text) => {
    expect(issues(text, "demo_advice")).toContain("tax_or_legal_advice");
  });

  it.each([
    "You don't have to pay it until the 15th.",
    "Selling your old car makes sense if you rarely drive it.",
    "Paying the card first saves you its 26.99% a year.",
    "The collector has to send you a validation notice within five days.",
    "Traditional banks charge more in fees than online ones.",
  ])("lets %j through", (text) => {
    expect(advice(text)).toBe(false);
  });
});
