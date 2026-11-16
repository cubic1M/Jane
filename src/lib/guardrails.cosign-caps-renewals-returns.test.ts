import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 57 (11-16): what a company may charge or renew, a cosigner said not to owe, a
// legal cap, what an ex or landlord has to pay or fix, money said safe from a partner's debt, when a
// collector may call, child support predicted, a fee called refundable, a
// return or a free month promised and a rate said to hold after an accident, on any account.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("cosigning, cap, renewal, repair and return claims on any account", () => {
  it.each([
    "They can't auto-renew you without telling you.",
    "T-Mobile can't charge an early termination fee if you move.",
    "You're not responsible for the loan you cosigned.",
    "Cosigning won't affect your credit.",
    "Payday loans are capped at 36% here.",
    "Your ex has to pay half the rent.",
    "Child support will go up when he gets a raise.",
    "Your landlord must fix the heater within 24 hours.",
    "The application fee is refundable.",
    "Amazon will accept the return after 30 days.",
    "Your joint account can't be frozen for your partner's debt.",
    "Debt collectors can only call between 8am and 9pm.",
    "Your Allstate rate won't change after the accident.",
    "You can't be charged interest on a deferred payment.",
    "Spotify will give you a free month if you cancel.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your T-Mobile bill of $90.00 is due Dec 1.",
    "Ask T-Mobile what the early termination fee is.",
    "Your cosigned loan payment of $400.00 posted Nov 1.",
    "Your Chime balance is $400.00.",
    "Your money at Chime is FDIC insured.",
    "You're not responsible for the $5.00 fee; it was refunded.",
    "Your child support payment of $400.00 posted Nov 1.",
    "Your apartment application fee of $90.00 posted Nov 1.",
    "Ask whether the application fee is refundable.",
    "Your Amazon return of $90.00 was credited Nov 1.",
    "Your joint account deposit of $400.00 arrived Nov 1.",
    "Your Spotify renewal of $15.49 is due Dec 1.",
    "The car budget is capped at 20% of income, which is $90.00 a month.",
    "You can't turn off autopay here; do it on T-Mobile's site.",
    "You don't have to tip on takeout.",
  ])("passes %s", (text) => {
    expect(real(text)).toMatchObject({ ok: true });
  });
});
