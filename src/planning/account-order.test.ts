import { describe, expect, it } from "vitest";
import { MIN_TAX_DRAG_CENTS, QUALIFIED_DIVIDEND_RATE } from "@/config/investing";
import { IRA_CATCH_UP_CENTS, IRA_LIMIT_CENTS } from "@/config/retirement";
import { CONTRIBUTION_LIMITS } from "@/config/tax-rates";
import { demoInvestments } from "@/lib/investments/__fixtures__/demo";
import {
  accountOrder,
  assetLocation,
  rothOrTraditionalByRate,
  taxDrag,
  unrealisedGains,
  type OrderInput,
} from "./account-order";

// Spec step 135: the right account for each dollar. The order is explained and changes
// with the profile.

const BASE: OrderInput = {
  age: 45,
  horizon: "over_20",
  goals: ["retirement"],
  marginalRate: 0.22,
  match: { captured: false, missedCents: 81_600, fullMatchRate: 0.06, employeeRate: 0.04 },
  employeeCents: 326_400,
  catchUpCents: 0,
  hasHsa: false,
};
const keys = (input: OrderInput) => accountOrder(input).map((s) => s.key);

describe("accountOrder", () => {
  it("puts the match first, then HSA, IRA, the rest of the 401(k), then taxable", () => {
    expect(keys(BASE)).toEqual(["match", "hsa", "ira", "workplace", "taxable"]);
    const [match, hsa, ira, workplace] = accountOrder(BASE);
    expect(match.why).toBe(
      "You put in 4%; the rest of the match is about $816 a year of free money.",
    );
    expect(hsa.roomCents).toBe(CONTRIBUTION_LIMITS.hsaSelf);
    expect(ira.roomCents).toBe(IRA_LIMIT_CENTS);
    expect(workplace.roomCents).toBe(2_450_000 - 326_400);
    for (const s of accountOrder(BASE)) expect(s.why.length).toBeGreaterThan(20);
  });

  it("changes with the profile: money needed soon for a home goes somewhere flexible after the match", () => {
    expect(keys({ ...BASE, horizon: "3_to_10", goals: ["home"] })).toEqual([
      "match",
      "flexible",
      "hsa",
      "ira",
      "workplace",
    ]);
    const [, flexible] = accountOrder({ ...BASE, horizon: "under_3", goals: ["education"] });
    expect(flexible.title).toBe("A 529 college savings plan, or a taxable account");
    expect(flexible.why).toMatch(/10% penalty if you take money out before 59½/);
    // Retirement money stays in the usual order even if it's needed soon.
    expect(keys({ ...BASE, horizon: "under_3" })).toEqual(keys(BASE));
  });

  it("changes with age and the tax bracket", () => {
    const older = accountOrder({ ...BASE, age: 58, catchUpCents: 800_000 });
    expect(older.find((s) => s.key === "ira")?.roomCents).toBe(
      IRA_LIMIT_CENTS + IRA_CATCH_UP_CENTS,
    );
    expect(older.find((s) => s.key === "hsa")?.roomCents).toBe(
      CONTRIBUTION_LIMITS.hsaSelf + CONTRIBUTION_LIMITS.hsaCatchUp55,
    );
    expect(accountOrder({ ...BASE, marginalRate: 0.12 })[2].title).toBe("A Roth IRA");
    expect(accountOrder({ ...BASE, marginalRate: 0.35 })[2].title).toBe("A traditional IRA");
    expect(accountOrder({ ...BASE, marginalRate: null })[2].title).toBe("An IRA");
    expect(keys({ ...BASE, match: null })[0]).toBe("hsa");
  });

  it("names Roth or traditional by the marginal rate", () => {
    expect([0.1, 0.12, 0.22, 0.24, 0.32, 0.37, null].map(rothOrTraditionalByRate)).toEqual([
      "roth",
      "roth",
      "mix",
      "mix",
      "traditional",
      "traditional",
      null,
    ]);
  });
});

describe("assetLocation and gains on the demo bank", () => {
  const accounts = demoInvestments().accounts;

  it("moves the dividend fund out of the taxable account, with its yearly tax", () => {
    const [move] = assetLocation(accounts, 0.22);
    expect(move.holding.ticker).toBe("PDIFX");
    expect(move.better).toBe("your Demo 401(k)");
    expect(move.taxDragCents).toBe(
      Math.round(move.holding.valueCents * 0.032 * QUALIFIED_DIVIDEND_RATE),
    );
    expect(move.taxDragCents).toBeGreaterThanOrEqual(MIN_TAX_DRAG_CENTS);
    // Nothing in the 401(k) is ever moved, and broad index funds stay put.
    const moved = assetLocation(accounts, 0.22).map((m) => m.holding.ticker);
    expect(moved).not.toContain("KLCX");
    expect(moved).not.toContain("NSTDX");
  });

  it("taxes interest at the marginal rate", () => {
    const bond = { ...accounts[0].holdings[0], ticker: "KTBIX", valueCents: 1_000_000 };
    expect(taxDrag(bond, 0.24)).toBe(Math.round(1_000_000 * 0.038 * 0.24));
    expect(assetLocation([accounts[1]], 0.22)).toEqual([]);
  });

  it("adds up gains and losses not yet taxed, from cost basis, in taxable accounts only", () => {
    const gains = unrealisedGains(accounts);
    const brokerage = accounts.find((a) => a.name === "Demo Brokerage")!;
    const expected = brokerage.holdings.filter((h) => h.gainCents !== null);
    expect(gains.gainsCents).toBe(
      expected.filter((h) => h.gainCents! > 0).reduce((s, h) => s + h.gainCents!, 0),
    );
    expect(gains.losers).toEqual([
      { name: "Pinnacle Dividend Income Fund", accountName: "Demo Brokerage", lossCents: 54_887 },
    ]);
  });
});
