import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 10 (11-12): options, crypto slang and gold as an investment, and legal rights
// stated as fact, got through on a real account.
const amounts = [500000, 145000, 120000, 4200, 2999, 1549];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("options, crypto slang and gold on a real account", () => {
  it.each([
    "Stack some sats every payday.",
    "Buy puts on Tesla before earnings.",
    "Selling cash-secured puts on Apple pays you to wait.",
    "Gold is a good hedge right now; get some.",
    "Put $500.00 into gold while it's cheap.",
    "Buying bullion protects you from inflation.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each([
    "Gold's Gym charges you $29.99 a month.",
    "You pay $15.49 for the Gold plan.",
    "Get the Gold rewards tier and you'd pay $15.49.",
    "You made 12 calls to Comcast last month.",
    "Your phone plan charges $42.00 for international calls.",
    "You spent $42.00 at Coinbase last month.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("legal rights stated as fact, on any account", () => {
  it.each([
    "Sue them in small claims court for the deposit.",
    "Take it to small claims and you'll get it back.",
    "You can break your lease without penalty because of the mold.",
    "You have the right to break your lease for that.",
    "Under the FCRA they have to delete it.",
    "Under state law your landlord must return the deposit within 21 days.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "You sent $42.00 to Sue for rent.",
    "Sue paid you back $42.00.",
    "I file small claims for you once you've checked them.",
    "Breaking your lease costs two months' rent, $1,450.00 each, per the lease you uploaded.",
    "Your rent is $1,450.00 on the 1st.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
