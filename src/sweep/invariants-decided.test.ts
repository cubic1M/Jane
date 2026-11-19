import { describe, expect, it } from "vitest";
import { decidedOnEstimate } from "./invariants";

// Class 4's decision side (the manager, 11-19): a payoff is offered only when checking as the bank
// or statement shows it covers it and its $500 cushion.

const flat = (shown: number, offered: boolean) => ({
  "decides.checkingAsShown": shown,
  "decides.payoffs.0.name": "Klarna Pay in 4",
  "decides.payoffs.0.balanceCents": 12_450,
  "decides.payoffs.0.canCoverPayoff": offered,
});

describe("a decision from an estimate", () => {
  it("fails a payoff offered when checking as shown doesn't cover it", () => {
    expect(decidedOnEstimate(flat(62_449, true))).toEqual([
      "decides.payoffs.0.canCoverPayoff: Klarna Pay in 4 offered with $624.49 in checking as shown, under its $124.50 and cushion",
    ]);
  });

  it("passes one checking covers as shown, and one not offered", () => {
    expect(decidedOnEstimate(flat(62_450, true))).toEqual([]);
    expect(decidedOnEstimate(flat(10_000, false))).toEqual([]);
  });
});
