import { describe, expect, it } from "vitest";
import { checkGuardrails, type GuardrailProfile } from "./guardrails";

// The chat's third policy round (11-06) dressed the moves up: hedged ("It might be worth…"),
// handed to someone else ("Most lawyers would say…"), or as a split, a level of risk or a habit.
// Investment and tax moves are held for a qualified person's review by Anthropic's Usage Policy
// from Nov 12, 2026, so the standard profile (every real account) stops them; legal claims stop in
// demo advice too (CLAUDE.md, step 98). Shopping, debt and what's there stay facts.
const issues = (text: string, profile: GuardrailProfile) => {
  const check = checkGuardrails(text, [], undefined, profile);
  return check.ok ? [] : check.issues;
};
const advice = (text: string, profile: GuardrailProfile = "standard") =>
  issues(text, profile).some((i) => i === "investment_advice" || i === "tax_or_legal_advice");

const MOVES = [
  "Many people in your spot move their savings into the market.",
  "It might be worth trimming your Nvidia position.",
  "Personally, I'd go all in on the S&P.",
  "The numbers say you should hold, not sell.",
  "An 80/20 split would suit you.",
  "You're too conservative; take on more risk.",
  "Keep buying every month no matter what the market does.",
  "It might be smart to claim the home office.",
  "Your side income is $8,000. Keep it off your return.",
  "You'd probably owe less if you filed separately.",
  "Don't pay the quarterly estimate; just pay in April.",
];

const LEGAL_CLAIMS = [
  "Most lawyers would say you have a case.",
  "You'd likely win in small claims.",
  "The collector has no right to call you at work, so tell them that.",
  "You're entitled to your full deposit back by law.",
];

describe("advice dressed up, on a real account", () => {
  it.each([...MOVES, ...LEGAL_CLAIMS])("stops %j", (text) => {
    expect(advice(text)).toBe(true);
  });

  it.each(LEGAL_CLAIMS)("stops %j in demo advice too", (text) => {
    expect(issues(text, "demo_advice")).toContain("tax_or_legal_advice");
  });

  it.each(MOVES)("still lets demo advice say %j, labelled", (text) => {
    expect(advice(text, "demo_advice")).toBe(false);
  });

  it.each([
    "The farmers market is open on Saturday.",
    "You trimmed $40 off your grocery bill.",
    "You spent $90 at the market this week.",
    "You have a case open with Chase about the charge.",
    "The family has a strong case for cutting cable.",
    "You won $50 in the office pool.",
    "Your quarterly estimate was paid on Sep 15.",
    "Keep the receipt with your records.",
    "An 80/20 split of rent between you and your roommate is $960 and $240.",
  ])("lets %j through", (text) => {
    expect(advice(text)).toBe(false);
  });
});
