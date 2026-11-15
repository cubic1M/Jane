import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 37 (11-14): real bank lines carry brands with "Invest" or "crypto" in the name
// (Plaid's "SoFi Invest", "Ally Invest", "Cash App Investing", "Venmo crypto"). Said as a line on
// a statement they are facts, as "a transfer to Fidelity" already was; anything else said about the
// brand is still a pick on a real account.
const amounts = [500, 9000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");

describe("a brand with Invest or crypto in its name, on a real account", () => {
  it.each([
    "Your SoFi Invest transfer of $90.00 posted Nov 2.",
    "Your Ally Invest transfer of $90.00 posted Nov 2.",
    "Your Cash App Investing transfer of $5.00 posted Nov 2.",
    "Merrill Invest charged a $5.00 fee on Nov 2.",
    "Venmo crypto purchase of $5.00 on Nov 2.",
    "A PayPal crypto sale of $90.00 landed Nov 3.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });

  it.each([
    "Open a SoFi Invest account.",
    "Use Ally Invest for this.",
    "Ally Invest is a good place for it.",
    "Move $90.00 into Ally Invest.",
    "Cash App Investing makes it easy to start.",
    "Buy crypto on Venmo.",
    "Venmo crypto is a good buy right now.",
    "Try Robinhood crypto.",
    "Invest the $90.00.",
  ])("still stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });
});
