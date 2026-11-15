import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 47 (11-15): what an insurer can't do, a premium predicted and money said to be
// out of creditors' reach, on any account; more coins and a hardship withdrawal, on a real account.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("insurer, premium and creditor claims on any account", () => {
  it.each([
    "Your insurer can't drop you for one claim.",
    "They can't deny the claim.",
    "Your premium will go down after 3 years.",
    "Your rate will go up if you file a claim.",
    "Filing a claim won't raise your rate.",
    "Your car insurance rate will drop next year.",
    "Your Social Security is protected from creditors.",
    "Your savings are safe from garnishment.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });
});

describe("coins and hardship withdrawals on a real account", () => {
  it.each([
    "Earn 5% on USDC at Coinbase.",
    "Cardano is a good bet.",
    "Buy Shiba Inu.",
    "Take a hardship withdrawal.",
    "Request a hardship withdrawal from your plan.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your hardship withdrawal of $400.00 arrived Nov 1.",
    "Ask for a hardship plan from the card company.",
    "Your claim was approved Nov 1.",
    "Your premium went up $15.49 in October.",
    "Your premium will go up $15.49 on Dec 1.",
    "Your premium will go up to $90.00 on Dec 1.",
    "Your card's rate will go up to 29.99% on Dec 1.",
    "Your Ripple Foods charge was $5.00.",
    "Your Tether Bike Shop tab was $90.00.",
    "They can't deliver until Nov 20.",
    "Your card is protected from fraud with the lock on.",
    "Your Coinbase One subscription is $5.00 a month.",
  ])("passes %s", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
