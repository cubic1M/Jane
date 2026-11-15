import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 44 (11-15): medical bills, old debt, credit reports and car deals read as law or
// promised, on any account; and a bankruptcy court fee or trustee payment on a real statement.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("debt, credit and car claims on any account", () => {
  it.each([
    "The hospital has to give you charity care.",
    "The dealer has to honor the advertised price.",
    "Your student loans can't be discharged.",
    "Your loan can be discharged if your school closed.",
    "Paying it will restart the clock.",
    "Making a payment will reset the statute of limitations.",
    "You can return the car within 3 days.",
    "The FTC cooling-off rule lets you cancel.",
    "You don't have to pay a bill you never agreed to.",
    "Your score will drop 100 points if you close it.",
    "Closing it will drop your score by 40 points.",
    "The collector will accept 30%.",
    "They'll settle for 50% if you call.",
    "Send a goodwill letter and they'll remove the late payment.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it("still blocks bankruptcy advice that names a court fee", () => {
    expect(real("File for bankruptcy; the bankruptcy court fee is $338.").ok).toBe(false);
    expect(real("File Chapter 7 to wipe it out.").ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your Chapter 13 trustee payment of $400.00 posted Nov 1.",
    "Your bankruptcy court payment of $90.00 posted Nov 1.",
    "Your Bankruptcy Court fee of $90.00 posted Nov 1.",
    "Your Navient loan was discharged on Nov 1.",
    "Your Hulu plan will restart on Dec 1.",
    "A hard inquiry could lower your score a few points.",
    "Your score went down 20 points in October.",
    "They'll remove the charge once the refund posts.",
    "You can return the car to Hertz by Nov 20.",
    "You don't have to pay anything today.",
    "You can ask the hospital about financial assistance.",
  ])("passes %s", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
