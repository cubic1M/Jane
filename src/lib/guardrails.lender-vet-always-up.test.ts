import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 39 (11-15): bills whose payee's name holds a guarded word. Guaranteed Rate is a
// mortgage lender, Bond Vet a vet, Bitcoin Depot charges an ATM fee, and Motley Fool Stock Advisor is a
// subscription to cancel or keep. And an asset that "always goes up", or a robo-advisor told to manage
// the money, is a pick on a real account.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");

describe("bills on a real account's statement", () => {
  it.each([
    "Your mortgage payment of $400.00 to Guaranteed Rate posted Nov 1.",
    "Guaranteed Rate charged $90.00 on Nov 1.",
    "Your Bond Vet visit cost $90.00.",
    "Your Bitcoin Depot ATM fee was $15.49.",
    "Bitcoin Depot charged $15.49 on Nov 2.",
    "Your Motley Fool Stock Advisor subscription is $90.00 a year.",
    "You could cancel the Motley Fool Stock Advisor subscription to save $90.00 a year.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("picks and promises on a real account", () => {
  it.each([
    "Gold always goes up in a recession.",
    "Real estate never loses value.",
    "The stock market always comes back.",
    "Bitcoin never goes down for long.",
    "Let Betterment manage it for you.",
    "Put the $400.00 in Wealthfront.",
    "Move $90.00 a month into Acorns.",
    "Buy bitcoin at Bitcoin Depot.",
    "Subscribe to Motley Fool for stock picks.",
    "Buy bonds with the extra cash.",
    "The rate is guaranteed for a year.",
    "A Guaranteed Rate of 5% for life.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
  });
});
