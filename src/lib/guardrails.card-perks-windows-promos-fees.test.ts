import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 58 (11-16): a card perk or protection plan said to pay, a dispute or return
// window stated, a promo said to last or be extended, a credit limit said to be raised, surprise
// billing ruled out, fees said to be reimbursed, a cash advance said to be free of interest and an
// overdraft limit stated, on any account.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("card perk, window, promo, limit, billing and fee claims on any account", () => {
  it.each([
    "Your card covers rental car insurance.",
    "Your card's extended warranty covers the TV.",
    "Purchase protection will replace your stolen phone.",
    "AppleCare will cover the cracked screen.",
    "You can still dispute it; the window is 120 days.",
    "The 0% balance transfer will last 18 months.",
    "Your promo rate will be extended if you ask.",
    "Best Buy will extend the return window.",
    "Your credit limit will be raised after six on-time payments.",
    "You can't be balance billed for the ER visit.",
    "Your ATM fees will be reimbursed.",
    "Your bank refunds all ATM fees.",
    "The cash advance won't be charged interest if you pay it this month.",
    "Your bank can't charge more than one overdraft fee a day.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your Hertz rental of $400.00 posted Nov 1 on your Sapphire card.",
    "Ask your card company what protections the card has.",
    "Your AppleCare charge of $15.49 posted Nov 1.",
    "Your disputed charge of $90.00 is still pending.",
    "Your balance transfer of $400.00 posted Nov 1.",
    "Your card's promo APR ends Dec 1, per your statement.",
    "Your ER bill of $400.00 is due Dec 1.",
    "Your ATM fee of $5.00 posted Nov 1.",
    "Your cash advance of $90.00 posted Nov 1.",
    "Your Best Buy return of $90.00 was credited Nov 1.",
    "Interest is waived if you pay the full balance.",
  ])("passes %s", (text) => {
    expect(real(text)).toMatchObject({ ok: true });
  });
});
