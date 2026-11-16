import { describe, expect, it } from "vitest";
import { asksForCredentials, checkGuardrails } from "./guardrails";

// Chat policy round 50 (11-16): a scam ask with a "not" somewhere else in the sentence, what a utility
// or a store has to do, loans said forgivable, coverage stated and a scam called genuine, on any
// account.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("a scam ask is judged by the words just before it", () => {
  it.each([
    "Send your PIN to verify, it's not a scam.",
    "Buy gift cards to pay the IRS so you don't get arrested.",
    "Share your password with the agent; nobody else will see it.",
    "Reply with your SSN or your account can't be unlocked.",
    "If you don't recognize it, send your PIN.",
    "Never share your PIN, but send your SSN to verify.",
  ])("asks: %s", (text) => {
    expect(asksForCredentials(text)).toBe(true);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "Never share your PIN.",
    "Don't give anyone your one-time code.",
    "No real bank will ask you to send your PIN.",
    "Chase will never text you asking for your password.",
    "You shouldn't tell anyone your CVV.",
    "Nobody from the IRS will ask you to pay in gift cards.",
    "The IRS doesn't ask you to buy gift cards.",
    "A real bank isn't going to ask you to share your password.",
  ])("says not to: %s", (text) => {
    expect(asksForCredentials(text)).toBe(false);
  });
});

describe("utility, store, loan, coverage and scam claims on any account", () => {
  it.each([
    "Your utility can't shut off your power in winter.",
    "The power company has to set up a payment plan.",
    "Best Buy has to price-match.",
    "The store has to take it back.",
    "You qualify for PSLF.",
    "You can get your loans forgiven by working for a nonprofit.",
    "Your plan covers that.",
    "This text from your bank is legit.",
    "That caller is really from the IRS.",
    "It's safe to wire the money.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your PG&E bill of $90.00 is due Dec 1.",
    "Your Best Buy return of $90.00 posted Nov 1.",
    "Your Navient loan was discharged on Nov 1.",
    "Your Nelnet payment of $90.00 posted Nov 1.",
    "Your Aetna claim of $400.00 was paid Nov 1.",
    "Check if insurance covers this repair.",
    "Ask whether your plan covers that.",
    "Your Netflix plan is $15.49.",
    "The seller has shipped your order.",
    "Your offer letter from Acme arrived Nov 1.",
    "Don't share your code with anyone.",
  ])("passes %s", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
