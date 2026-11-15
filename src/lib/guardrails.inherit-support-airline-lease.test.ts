import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 48 (11-15): who inherits, changing child support, what a company owes, collecting
// unemployment while working, someone else's debts, breaking a lease and a mark said not to count, on
// any account.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("estate, family, company and credit claims on any account", () => {
  it.each([
    "Your spouse will inherit everything automatically.",
    "You can lower your child support by asking the court.",
    "The airline owes you compensation for the delay.",
    "Airbnb has to refund you.",
    "You can collect unemployment while freelancing.",
    "Don't report the freelance work to unemployment.",
    "You're not responsible for your spouse's debts.",
    "You can break the lease if you lose your job.",
    "Paid collections won't hurt your score anymore.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your child support payment of $400.00 posted Nov 1.",
    "Your alimony payment of $400.00 arrived Nov 1.",
    "Lower your spending to keep up with child support.",
    "Your unemployment deposit of $400.00 arrived Nov 1.",
    "Keep your unemployment deposits in savings while you look for work.",
    "Your Delta refund of $90.00 posted Nov 1.",
    "Comcast refunded you $15.49 on Nov 1.",
    "Your Airbnb refund of $90.00 posted Nov 1.",
    "Your roommate's Venmo of $90.00 posted Nov 1.",
    "You're not responsible for the $5.00 fee; it was refunded.",
    "Breaking the lease costs $400.00 under your lease.",
    "This won't affect your credit score.",
    "Checking your score won't hurt your credit.",
    "Your Inherit Wine Bar charge was $5.00.",
  ])("passes %s", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
