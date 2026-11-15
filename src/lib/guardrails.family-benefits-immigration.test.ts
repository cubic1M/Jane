import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 45 (11-15): a relative's debts, benefits kept by not reporting and immigration,
// on any account; and investing said as "diversify into" or "get into", on a real account.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("family, benefits and immigration claims on any account", () => {
  it.each([
    "You don't have to pay your dad's debts.",
    "You don't need to pay off your mom's credit cards.",
    "You'll keep your SNAP if you don't report it.",
    "Don't report the gig income or you'll lose your benefits.",
    "Social Security won't count that income.",
    "Medicaid won't count your side income.",
    "You can get your green card faster if you pay it off.",
    "This could hurt your immigration status.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });
});

describe("investing said another way on a real account", () => {
  it.each([
    "Diversify into gold.",
    "Diversify your portfolio with bonds.",
    "Get into real estate.",
    "Now's a good time to get into crypto.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your USCIS fee of $90.00 posted Nov 1.",
    "Your green card renewal fee of $400.00 posted Nov 1.",
    "This will help you pay off your Visa card faster.",
    "Your Visa card was approved for a higher limit.",
    "Your dad's Amex payment of $90.00 posted Nov 1.",
    "You don't have to pay your Comcast bill until Nov 20.",
    "Report the lost card to the bank.",
    "You get your SNAP deposit on the 5th.",
    "Get into the habit of checking your balance.",
    "Your income is diversified across two jobs.",
    "Your Diversified Services charge was $15.49.",
    "Your Rebel Real Estate fee was $90.00.",
  ])("passes %s", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
