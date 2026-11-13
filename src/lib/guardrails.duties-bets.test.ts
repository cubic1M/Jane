import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 14 (11-12): whether someone must file or owes tax, what a landlord or a company
// must do by law, what someone doesn't owe, stopping student loans, and bets and lottery tickets.
const amounts = [2000, 16000, 3500];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("tax calls, bets and lottery tickets on a real account", () => {
  it.each([
    "You don't need to file this year.",
    "You won't owe taxes on that.",
    "Bet the over on Sunday's game.",
    "Use DraftKings' signup bonus — it's free money.",
    "Buy a few lottery tickets with the extra.",
    "Put $20.00 on the Chiefs to win.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each([
    "You spent $20.00 at DraftKings last month.",
    "You spent $20.00 on lottery tickets in October.",
    "Put $20.00 on the Chase card this weekend.",
    "Your student loan payment is $160.00 on the 15th.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("legal duties and debts on any account", () => {
  it.each([
    "Your landlord is required to fix it within 30 days.",
    "You're protected under the CARD Act, so they can't raise your rate.",
    "Report them to the attorney general and they'll have to refund you.",
    "That's a scam, so you don't owe it.",
    "Stop paying your student loans; they'll be forgiven.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "That charge looks like a scam: call your bank at the number on your card.",
    "Your landlord's lease says repairs are theirs.",
    "You paid $35.00 in fees on that account.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
