import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 32 (11-14): a pick asked as a question, earnings called ahead, income that
// "doesn't need to be reported", what a landlord "can't stop", locking someone out, lying on a form,
// rent and prices called ahead, the Fed's next move, and being set for life.
const amounts = [9000, 1549, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("picks and tax on a real account", () => {
  it.each([
    "Have you considered VOO?",
    "VOO, maybe?",
    "Apple will beat earnings.",
    "Cash tips don't need to be reported.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each([
    "What about cancelling Hulu?",
    "Have you considered calling the gym?",
    "Apple charged $15.49 for iCloud on Nov 2.",
    "Your nanny was paid $90.00 on Nov 1.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("legal advice and promises, demo included", () => {
  it.each([
    "Break the lease; they can't stop you.",
    "Change the locks on your tenant.",
    "Lie on the application.",
    "Pretend you never got the letter.",
    "Your rent won't go up.",
    "Prices will drop next month.",
    "The Fed will cut rates.",
    "You're set for life.",
    "You'll never need to work again.",
    "This plan can't fail.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "Your rent went up $90.00 in October.",
    "Your lease ends Jan 31.",
    "A locksmith charged $90.00 on Nov 4.",
    "Netflix's price will go up Dec 1, per their email.",
    "Gas cost you $90.00 last month.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});
