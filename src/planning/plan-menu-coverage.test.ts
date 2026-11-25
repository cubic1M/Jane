import { describe, expect, it } from "vitest";
import {
  cheapestMix,
  parseDisclosure,
  targetDateCheck,
  withoutGuessedMix,
  type MenuFund,
  type MenuMix,
} from "./plan-menu";

const OPTS = { today: "2026-10-19", risk: 3 as const };
const MIX: MenuMix = { us_stocks: 0.6, intl_stocks: 0.3, bonds: 0.1, cash: 0 };
const target = (over: Partial<MenuFund> = {}): MenuFund => ({
  ticker: "ZZTDX",
  name: "Acme 2045 Fund",
  expenseBps: 75,
  kind: "target_date",
  mix: MIX,
  ...over,
});

describe("a target-date fund against building it by hand: only with full coverage", () => {
  it("reports no saving when the menu has nothing to build the mix from", () => {
    const fund = target();
    expect(cheapestMix([fund], fund.mix!).allocation).toEqual([]);
    expect(targetDateCheck([fund], fund, 10_000_000)).toBeNull();
  });
  it("reports no saving when an exposure the fund holds has no fund on the menu", () => {
    const fund = target();
    const stocksOnly: MenuFund[] = [
      fund,
      { ticker: "AAAIX", name: "US index", expenseBps: 3, kind: "us_stocks", mix: null },
    ];
    expect(targetDateCheck(stocksOnly, fund, 10_000_000)).toBeNull();
  });
  it("keeps the comparison when every exposure is on the menu", () => {
    const fund = target();
    const menu: MenuFund[] = [
      fund,
      { ticker: "AAAIX", name: "US index", expenseBps: 3, kind: "us_stocks", mix: null },
      { ticker: "BBBIX", name: "Intl index", expenseBps: 8, kind: "intl_stocks", mix: null },
      { ticker: "CCCIX", name: "Bond index", expenseBps: 5, kind: "bonds", mix: null },
    ];
    expect(targetDateCheck(menu, fund, 10_000_000)!.savingCents).toBeGreaterThan(0);
  });
});

describe("a target-date fund's holdings do not depend on who is looking", () => {
  const line = "ZZTDX  Acme Retirement 2045 Fund  0.75%  target date";
  it("gives an unknown target-date fund no holdings, whatever the risk level", () => {
    for (const risk of [1, 3, 5] as const) {
      const { funds } = parseDisclosure(line, { today: "2026-10-19", risk });
      expect(funds[0].mix, `risk ${risk}`).toBeNull();
    }
    expect(OPTS.risk).toBe(3);
  });
  it("so it reports no saving for it", () => {
    const { funds } = parseDisclosure(line, OPTS);
    expect(targetDateCheck(funds, funds[0], 10_000_000)).toBeNull();
  });
});

describe("a disclosure confirmed before the parse rule changed (CodeRabbit sweep 1d)", () => {
  it("loses a glide-path mix on a target-date fund Jane has no holdings for", () => {
    const stored = target();
    expect(withoutGuessedMix([stored])[0]!.mix).toBeNull();
  });
  it("keeps the mix of a fund whose holdings Jane has, and of other kinds", () => {
    const other = target({ ticker: "VFIAX", kind: "us_stocks" });
    expect(withoutGuessedMix([other])[0]!.mix).toEqual(MIX);
  });
});
