import { describe, expect, it } from "vitest";
import { dockDoubles } from "./invariants";
import { keyFamily } from "./snapshot";

// Class 7 in the dock, by key (debug 3, 11-22): gate C's retiree had nine "Your cash is …" cards in
// the dock, each keyed by a hash of that day's amounts, so no two shared a headline or a merchant.

const card = (i: number, headline: string, family: string | null) => ({
  [`dock.${i}.about`]: null,
  [`dock.${i}.headline`]: headline,
  [`dock.${i}.family`]: family,
});

describe("one family of keys, one dock card", () => {
  it("leaves out a key's hashes and numbers, and has none without them", () => {
    expect(keyFamily("investments:cash:d89db0c5bf5b8a58833491a1")).toBe("investments:cash:#");
    expect(keyFamily("bnpl:bnpl_payoff:affirm-1:12000")).toBe("bnpl:bnpl_payoff:affirm-1:#");
    expect(keyFamily("findings:cmwtgc1s001i0z908j6pa0r4a")).toBeNull();
    expect(keyFamily("tight_money:tight:2026-12:hardship:card")).toBeNull();
    expect(keyFamily(null)).toBeNull();
  });

  it("fails two cards of one family (the retiree, Nov 23)", () => {
    expect(
      dockDoubles({
        ...card(0, "Your cash is $74,685.39 and earns about $261.05 a year.", "investments:cash:#"),
        ...card(1, "Coming up in 3 days: Demo Credit Card payment", null),
        ...card(2, "Your cash is $74,547.14 and earns about $260.95 a year.", "investments:cash:#"),
      }),
    ).toEqual([
      `dock.2: "Your cash is $74,547.14 and earns about $260.95 a year." is dock.0 "Your cash is $74,685.39 and earns about $261.05 a year." again (investments:cash:#)`,
    ]);
  });

  it("passes cards of different families, and cards with none", () => {
    expect(
      dockDoubles({
        ...card(0, "Your cash is $74,685.39.", "investments:cash:#"),
        ...card(1, "You can pay off the Affirm plan now.", "bnpl:bnpl_payoff:affirm-1:#"),
        ...card(2, "Coming up in 3 days: rent", null),
        ...card(3, "Coming up in 2 days: card payment", null),
      }),
    ).toEqual([]);
  });
});
