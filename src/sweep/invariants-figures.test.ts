import { describe, expect, it } from "vitest";
import { sameFigures } from "./invariants";

// The same-figure rule (class 4, debug3-invariants.md).

const person = (overrides: Record<string, unknown> = {}) => ({
  "home.hero.netWorth.cents": 17_820_517,
  "netWorth.length": 2,
  "netWorth.1.cents": 17_820_517,
  "chat.what's my net worth.body":
    "Your net worth is $178,205.17: you have $529,380.67 and owe $351,175.50.",
  "trees.ahead.tree.branches.worth.items.worth:today.figure": "$178k",
  "trees.money.tree.branches.have.items.have:net-worth.figure": "$178k",
  "home.summary.safeToSpend.safeCents": -10_480,
  "home.hero.safe.cents": 10_480,
  "home.hero.safe.short": true,
  "chat.what's safe to spend.body": "You have −$104.80 safe to spend until your next payday.",
  "tiles.loans.value": "$351k",
  "trees.money.tree.branches.have.items.have:loans.figure": "$351k",
  ...overrides,
});

describe("one figure, everywhere it's shown", () => {
  it("holds when each reads the same, a short one rounded", () => {
    expect(sameFigures(person())).toEqual([]);
    expect(
      sameFigures(
        person({
          "home.hero.netWorth.cents": 106_874_885,
          "netWorth.1.cents": 106_874_885,
          "chat.what's my net worth.body": "Your net worth is $1,068,748.85.",
          "trees.ahead.tree.branches.worth.items.worth:today.figure": "$1.1M",
          "trees.money.tree.branches.have.items.have:net-worth.figure": "$1.1M",
        }),
      ),
    ).toEqual([]);
  });

  it("catches one that reads another figure (#1904, #1938)", () => {
    expect(
      sameFigures(
        person({ "trees.money.tree.branches.have.items.have:net-worth.figure": "$175k" }),
      ),
    ).toHaveLength(1);
    expect(
      sameFigures(person({ "chat.what's safe to spend.body": "You have $104.80 safe to spend." })),
    ).toHaveLength(1);
    expect(sameFigures(person({ "tiles.loans.value": "$35k" }))).toHaveLength(1);
  });
});
