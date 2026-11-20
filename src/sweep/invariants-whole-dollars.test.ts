import { describe, expect, it } from "vitest";
import { sameFigures } from "./invariants";

// A tree's figure in whole dollars is the exact one rounded to its own last digit (class 4): net
// worth $877.38 reads "$877" under $1,000, where a larger one reads "$12k" (upload S5's sweep
// person, debug 3, 11-19).

const worth = (cents: number, figure: string) => ({
  "home.hero.netWorth.cents": cents,
  "trees.ahead.tree.branches.worth.items.worth:today.figure": figure,
  "trees.money.tree.branches.have.items.have:net-worth.figure": figure,
});

describe("a figure in whole dollars", () => {
  it("is the exact figure rounded to the dollar", () => {
    expect(sameFigures(worth(87_738, "$877"))).toEqual([]);
    expect(sameFigures(worth(87_750, "$878"))).toEqual([]);
  });

  it("isn't a figure a dollar or more off", () => {
    expect(sameFigures(worth(87_738, "$876"))).toEqual([
      `trees.ahead…worth:today.figure: "$876", net worth is 877.38`,
      `trees.money…have:net-worth.figure: "$876", net worth is 877.38`,
    ]);
  });

  it("still holds a figure with cents to the cent", () => {
    expect(
      sameFigures({
        "home.hero.netWorth.cents": 87_738,
        "chat.what's my net worth.body": "Your net worth is $877.88.",
      }),
    ).toEqual([`chat.what's my net worth.body: "$877.88.", net worth is 877.38`]);
  });
});
