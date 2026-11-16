import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Debugger 11-16 (Plaid sandbox, checking + a Discover card, phone): "what's my credit card
// balance?" read "I can't answer that one yet", though Loans said "You owe $1,890.00" and "what's
// the rate on my card" was understood. A debt's balance is that debt.

const intent = (text: string) => parseIntent(text, "2026-11-16");

describe("a debt's balance", () => {
  it("is that debt", () => {
    expect(intent("what's my credit card balance?")).toEqual({
      kind: "debt_detail",
      target: "credit card",
    });
    expect(intent("what is the balance on my card")).toEqual({
      kind: "debt_detail",
      target: "card",
    });
    expect(intent("what's my car loan balance")).toEqual({
      kind: "debt_detail",
      target: "car loan",
    });
    expect(intent("how much is on my credit card")).toEqual({
      kind: "debt_detail",
      target: "credit card",
    });
  });

  it("checking's balance isn't a debt", () => {
    expect(intent("what's my checking balance")).not.toMatchObject({ kind: "debt_detail" });
  });
});
