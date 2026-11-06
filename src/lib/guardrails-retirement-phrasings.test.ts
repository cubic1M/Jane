import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Security round 48: #1534 stopped retirement, Social Security and withholding moves on a real
// account, but the same moves said another way still got through the standard profile. What
// someone did, and how a rule works, stay facts.
const advice = (text: string, allowedCents: number[] = []) => {
  const check = checkGuardrails(text, allowedCents);
  return (
    !check.ok && check.issues.some((i) => i === "investment_advice" || i === "tax_or_legal_advice")
  );
};

describe("retirement and withholding moves said another way", () => {
  it.each([
    "Hold off on Social Security until 70.",
    "Don't take Social Security yet.",
    "Your best move is to claim Social Security at 67.",
    "Wait until 70 to claim your benefits.",
    "Exercise your ISOs before year end.",
    "Withhold more from your paycheck.",
    "Claim fewer allowances on your W-4.",
  ])("stops %j", (text) => {
    expect(advice(text)).toBe(true);
  });

  it("stops one with a figure Jane can back", () => {
    expect(advice("Have your employer withhold an extra $100.00 a paycheck.", [10_000])).toBe(true);
  });

  it.each([
    "You started Social Security at 62.",
    "Your Social Security deposit was $1,850.00 this month.",
    "If you wait until 70 to claim, the monthly benefit is larger.",
    "You exercised 100 ISOs in March.",
    "Your employer withholds $300.00 a paycheck.",
    "Jane can't tell you when to take Social Security.",
  ])("lets the fact %j through", (text) => {
    expect(advice(text, [185_000, 30_000])).toBe(false);
  });
});
