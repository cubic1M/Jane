import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 38 (11-15): real bank lines whose names hold an investing word. A credit union
// pays savings interest as a "dividend", Portfolio Recovery Associates is a debt collector, Equity
// Residential takes rent, and Fidelity Investments is a transfer. And money sent to a brokerage as an
// instruction ("Put it in Fidelity") is a pick on a real account.
const amounts = [500, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");

describe("lines on a real account's statement", () => {
  it.each([
    "Your credit union paid a $5.00 dividend on your savings on Nov 1.",
    "A dividend of $5.00 posted to Share Savings on Nov 1.",
    "You paid Portfolio Recovery Associates $90.00 on Nov 2.",
    "Portfolio Recovery Associates is collecting $400.00 from you.",
    "Your rent of $400.00 to Equity Residential posted Nov 1.",
    "A transfer of $90.00 to Fidelity Investments posted Nov 2.",
    "Edward Jones Investments charged $90.00 on Nov 1.",
    "Your Stock Yards Bank checking has $400.00.",
    "You moved $90.00 to Fidelity on Nov 2.",
    "You put $90.00 into Robinhood on Nov 3.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("picks on a real account", () => {
  it.each([
    "Buy dividend stocks.",
    "Look for high-dividend funds instead of savings.",
    "Dividends are a great way to grow your savings.",
    "Put your savings into dividends.",
    "Reinvest your dividends.",
    "Add to your portfolio.",
    "Build an equity position.",
    "Open a Fidelity Investments account.",
    "Fidelity Investments is a good place for your savings.",
    "Put it in Fidelity.",
    "Move your bonus to Vanguard.",
    "Then send $90.00 to Robinhood.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });
});
