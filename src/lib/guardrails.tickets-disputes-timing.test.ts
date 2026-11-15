import { describe, expect, it } from "vitest";
import { TAX_SOURCES } from "@/config/sudden-money";
import { checkGuardrails } from "./guardrails";

// Chat policy round 40 (11-15): tax claims about what needn't be reported or isn't taxable, legal
// claims about tickets, summonses and frozen accounts, a dispute promised won or reversed, and
// buying or selling around an event, on real accounts.
const amounts = [500, 1549, 9000, 40000, 1800000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("tax, legal, promises and timing on a real account", () => {
  it.each([
    "You don't need to report Venmo payments.",
    "Don't bother reporting your side gig income.",
    "Inheritance isn't taxable.",
    "Your life insurance payout isn't taxable.",
    "You don't have to pay the parking ticket.",
    "You don't need to pay that speeding fine.",
    "Ignore the jury summons.",
    "Skip the court date.",
    "Venmo can't freeze your account.",
    "Your bank can't keep your deposit.",
    "You'll win the dispute.",
    "Your chargeback will go your way.",
    "The bank will reverse it.",
    "The merchant will refund the charge.",
    "VTI and chill.",
    "Index funds and chill.",
    "Sell everything before the election.",
    "Buy before the rate cut.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
  });
});

describe("what still passes", () => {
  it.each([
    "You don't need to pay the ticket until Dec 1.",
    "You don't need to report the payment to Venmo as fraud.",
    "You disputed the $90.00 charge on Nov 2.",
    "The bank reversed the $15.49 fee on Nov 3.",
    "Your Social Security deposit of $400.00 posted Nov 3.",
    "Your Klarna payment of $15.49 is due Nov 20.",
    "Buy the plane tickets before Nov 20 to keep the $90.00 fare.",
  ])("lets %s through on a real account", (text) => {
    expect(real(text).ok).toBe(true);
  });

  // The sudden-money page (demo advice) cites IRS Publication 559; demo advice may say how an
  // inheritance is taxed.
  it("keeps the sudden-money page's inheritance source on demo advice", () => {
    expect(demo(TAX_SOURCES.inheritance).ok).toBe(true);
    expect(demo("Inheritance isn't taxable.").ok).toBe(true);
  });
});
