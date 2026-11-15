import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 41 (11-15): bills whose payee's name holds a guarded word (Promise Pay, the
// Crypto.com Visa card, Sure Thing Plumbing), and on real accounts: lying in a dispute, flipping
// houses, franchises, peer-to-peer lending, crowdfunded real estate and a promised retirement.
const amounts = [500, 1549, 9000, 40000, 4000000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");

describe("bills on a real account's statement", () => {
  it.each([
    "Your Promise Pay utility payment of $90.00 posted Nov 1.",
    "PROMISE PAY charged $90.00 on Nov 1.",
    "Your Crypto.com Visa card charge of $15.49 posted Nov 2.",
    "Your Sure Thing Plumbing bill was $90.00.",
    "Your Prosper loan payment of $90.00 posted Nov 1.",
    "Your LendingClub payment of $90.00 posted Nov 1.",
    "If you didn't make the charge, say so when you call.",
    "Tell the bank your card was stolen and ask for a new one.",
    "You could be debt-free by June at $400.00 a month.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("lies, picks and promises on a real account", () => {
  it.each([
    "Just say you didn't authorize it.",
    "Claim the package never arrived.",
    "Pretend the card was stolen.",
    "Say it was fraud even though you got the item.",
    "Flip a house with that money.",
    "Buy a franchise with your savings.",
    "Lend money on Prosper for better returns.",
    "Try peer-to-peer lending.",
    "Put the $40,000.00 into Fundrise.",
    "You'll retire early on this plan.",
    "You'll be a homeowner by 30.",
    "It's a sure thing.",
    "Buy crypto.",
    "I promise you'll save money.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
  });
});
