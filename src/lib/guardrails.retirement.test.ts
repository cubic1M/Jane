import { describe, expect, it } from "vitest";
import { checkGuardrails, type GuardrailProfile } from "./guardrails";

// Personalized investment and tax moves are held for a qualified person's review by Anthropic's
// Usage Policy from Nov 12, 2026. The chat's audit (11-06) found these got past the standard
// profile, the one every real account gets: retirement and HSA/529 money as the move, when to
// take Social Security or a pension, stock options, tax-loss harvesting, a target-date fund, and
// changing what's withheld. What someone did and what's there stay facts.
const advice = (text: string, profile: GuardrailProfile = "standard") => {
  const check = checkGuardrails(text, [], undefined, profile);
  return (
    !check.ok && check.issues.some((i) => i === "investment_advice" || i === "tax_or_legal_advice")
  );
};

const MOVES = [
  "Contribute the full $4,300 to your HSA.",
  "Put the bonus in your HSA.",
  "You should open a 529 for her.",
  "Use a 529 plan for your daughter.",
  "Put 10% of your pay into retirement.",
  "Save the bonus for retirement.",
  "Take Social Security at 70, not 62.",
  "Delay Social Security until 67.",
  "I'd wait to claim Social Security.",
  "Start your pension at 65.",
  "Exercise your options now.",
  "Sell your RSUs as they vest.",
  "Harvest the loss before December.",
  "Do some tax-loss harvesting this year.",
  "Pick the target-date 2055 fund.",
  "Take your required minimum distribution in December.",
  "Increase your withholding on your W-4.",
  "Fill out a new W-4.",
];

describe("retirement, investment and withholding moves on a real account", () => {
  it.each(MOVES)("stops %j", (text) => {
    expect(advice(text)).toBe(true);
  });

  it.each([
    "Your HSA balance is $3,000.",
    "Contributions to your 529 came to $200.00.",
    "Contributions to your retirement plan were $450.00 in October.",
    "You put $4,300 into your HSA this year.",
    "Use your HSA card for the pharmacy bill.",
    "Your FSA has $400 left; it ends Dec 31.",
    "Your pension pays $1,200 a month.",
    "Social Security deposits $2,100 on the 3rd.",
    "Social Security: $2,045 a month if you start at 62, $2,921 at 67.",
    "Required minimum distributions start at 73.",
    "Put the $200 in savings.",
    "Save $300 a month for the trip.",
    "Move $500 to savings.",
    "Exercise class costs $40 a month.",
    "Your options: cancel, pause, or keep it.",
    "Your withholding so far is $2,100.",
    "Your employer withheld $310 from each paycheck.",
    "Harvest Market charged $54.",
    "Start the budget on the 1st.",
    "Keep the receipts.",
  ])("lets %j through", (text) => {
    expect(advice(text)).toBe(false);
  });

  it.each(MOVES)("still lets demo advice say %j, labelled", (text) => {
    expect(advice(text, "demo_advice")).toBe(false);
  });
});
