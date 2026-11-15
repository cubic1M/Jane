import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 43 (11-15): labor law read as fact and what someone "can't make you pay", on
// any account; and a small claims court fee or a paycheck on a real account's statement.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("labor law and pay claims on any account", () => {
  it.each([
    "Your employer can't make you pay that back.",
    "Your boss can't withhold your last paycheck.",
    "They can't dock your pay for that.",
    "Netflix can't make you pay for a month you canceled.",
    "Your final paycheck has to come within 72 hours.",
    "Your tips belong to you by law.",
    "You should get overtime for that.",
    "You can file a wage claim and get it back.",
    "Your 1099 job means they owe you benefits.",
    "You're misclassified as a contractor.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it("still blocks a small claims suit", () => {
    expect(real("You can file in small claims court.").ok).toBe(false);
    expect(real("Take them to small claims court.").ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your small claims court filing fee of $90.00 posted Nov 1.",
    "Your small claims court payment of $90.00 posted Nov 2.",
    "Your PTO payout of $400.00 posted Nov 1.",
    "Your final paycheck of $400.00 arrived Nov 1.",
    "Your overtime pay was $90.00 this check.",
    "Your paycheck has to clear before the rent posts.",
    "Your employer withholds $90.00 for taxes.",
    "They can't make it to your call today.",
  ])("passes %s", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
