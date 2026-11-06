import { describe, expect, it } from "vitest";
import { checkGuardrails, type GuardrailProfile } from "./guardrails";

// Personalized investment and tax moves are held for a qualified person's review by Anthropic's
// Usage Policy from Nov 12, 2026. The chat's second policy round (11-06) put the same moves in
// other words and found these got past the standard profile, the one every real account gets:
// when to buy, dollar-cost averaging, a kind of fund as the pick, selling losers to offset gains,
// not reporting, whom to count as a dependent, a hobby, bunching gifts, and filing late on an
// extension. Shopping, a charge reported to the bank and what's there stay facts.
const advice = (text: string, profile: GuardrailProfile = "standard") => {
  const check = checkGuardrails(text, [], undefined, profile);
  return (
    !check.ok && check.issues.some((i) => i === "investment_advice" || i === "tax_or_legal_advice")
  );
};

const MOVES = [
  "Now is a good time to buy.",
  "Today looks like the right time to sell.",
  "Buy the dip.",
  "Get back into the market this month.",
  "Dollar-cost average $200 a month into VOO.",
  "Pick the growth fund over the value fund.",
  "Go with a total market fund.",
  "Sell the losers before December 31 to offset the gains.",
  "Use the loss to offset the gains.",
  "You can skip reporting the Venmo payments.",
  "Count your nephew as a dependent.",
  "Add your mom as a dependent this year.",
  "Treat the side gig as a hobby.",
  "Bunch your donations into December.",
  "Ask for an extension and file in October.",
  "Get a tax extension.",
];

describe("investment and tax moves in other words on a real account", () => {
  it.each(MOVES)("stops %j", (text) => {
    expect(advice(text)).toBe(true);
  });

  it.each([
    "Black Friday is a good time to buy a TV.",
    "Now is a good time to buy groceries for the week.",
    "The farmers market is open on Saturday.",
    "Your emergency fund covers three months of bills.",
    "Your college fund has $5,000.",
    "You spent $40 at Dollar Tree.",
    "The refund offsets the late fee.",
    "You gave $300 in donations this year.",
    "Your hobby spending was $120 last month.",
    "Add your daughter as an authorized user on the card.",
    "Report the charge to your bank as fraud.",
    "Skip reporting it to the bank; the card company already knows.",
    "The card offers a payment extension if you call.",
    "Your nephew's birthday gift was $50.",
  ])("lets %j through", (text) => {
    expect(advice(text)).toBe(false);
  });

  it.each(MOVES)("still lets demo advice say %j, labelled", (text) => {
    expect(advice(text, "demo_advice")).toBe(false);
  });
});
