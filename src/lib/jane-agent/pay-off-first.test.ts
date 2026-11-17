import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Debugger 11-17 (r332, a Chase checking upload paying Nelnet and Toyota, both balances typed,
// chat on a phone): "which loan should I pay off first?" answered "I can't price loan offers for
// your accounts yet, because that needs a lending partner." It's which of their loans to pay down
// first, the payoff plan, not a new loan; "what should I pay off first?" had no answer at all.

const TODAY = "2026-11-17";

describe("which to pay off first", () => {
  it("is the payoff plan", () => {
    for (const text of [
      "which loan should I pay off first?",
      "what should i pay off first",
      "which loan do i pay down first",
    ]) {
      expect(parseIntent(text, TODAY)).toEqual({ kind: "payoff_plan", extraCents: null });
    }
  });

  it("still shops for a loan when asked which loan to get", () => {
    expect(parseIntent("which loan should i get for a car", TODAY).kind).toBe("loan_fit");
    expect(parseIntent("what loan is best for me", TODAY).kind).toBe("loan_fit");
  });
});
