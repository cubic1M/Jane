import { describe, expect, it } from "vitest";
import { themeExits } from "./themes";

// CodeRabbit sweep 1c, pl-09 #5: the exit's clock and cost basis come from the theme buy.

const state = { cashCents: 0, positions: { ITA: { quantity: 20, costBasisCents: 200_000 } } };
const themeBuy = {
  placedAt: "2026-09-01T21:30:00.000Z",
  side: "buy",
  ticker: "ITA",
  quantity: 10,
  amountCents: 100_000,
  rule: "theme_idea",
};
const laterBuy = {
  placedAt: "2026-09-20T21:30:00.000Z",
  side: "buy",
  ticker: "ITA",
  quantity: 10,
  amountCents: 150_000,
  rule: "model_buy",
};

describe("themeExits and a later buy under another rule", () => {
  it("still exits after the month counted from the theme buy", () => {
    const [exit] = themeExits(state, { ITA: 10_500 }, [themeBuy, laterBuy], "2026-09-29");
    expect(exit?.reason).toMatch(/after 20 trading days.*buy on 2026-09-01/);
  });

  it("measures the stop against the theme buy's price, not the later one", () => {
    // $100/share at the theme buy, $150 at the later buy; $91 is down 9% from the first.
    const [exit] = themeExits(state, { ITA: 9_100 }, [themeBuy, laterBuy], "2026-09-03");
    expect(exit?.reason).toMatch(/at the stop: down 9\.0%/);
  });

  it("does not exit a position no theme buy opened", () => {
    expect(themeExits(state, { ITA: 1 }, [laterBuy], "2027-01-01")).toEqual([]);
  });
});
