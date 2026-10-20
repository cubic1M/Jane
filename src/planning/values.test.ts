import { describe, expect, it } from "vitest";
import { FUND_FACTS } from "@/config/funds";
import { THEME_TILT_SHARE } from "@/config/values";
import type { HoldingView, InvestmentAccountView } from "@/insights/investments";
import { coreFundsFor, fundFor, tiltFund, valuesPlan, type Prefs } from "./values";

const holding = (
  ticker: string,
  valueCents: number,
  mix: HoldingView["mix"],
  costBasisCents: number | null = null,
): HoldingView => ({
  id: `h-${ticker}`,
  accountId: "a",
  name: ticker,
  ticker,
  type: "mutual fund",
  isCash: false,
  quantity: 1,
  priceCents: valueCents,
  valueCents,
  costBasisCents,
  gainCents: costBasisCents === null ? null : valueCents - costBasisCents,
  expenseRatioBps: FUND_FACTS[ticker]?.expenseRatioBps ?? null,
  category: null,
  mix,
  source: "",
  factsSource: null,
});

const account = (id: string, subtype: string, holdings: HoldingView[]): InvestmentAccountView => ({
  id,
  name: `${subtype} ${id}`,
  kind: "investment",
  label: subtype,
  subtype,
  balanceCents: holdings.reduce((s, h) => s + h.valueCents, 0),
  holdingsCents: holdings.reduce((s, h) => s + h.valueCents, 0),
  holdingsMatch: true,
  holdings,
  institution: null,
});

const NONE: Prefs = { excludes: [], themes: [] };
const ALL: Prefs = { excludes: ["fossil_fuels", "weapons", "tobacco"], themes: [] };
const BROKERAGE = account("b", "brokerage", [
  holding("KTSIX", 10_000_00, { us_stocks: 1 }, 6_000_00),
  holding("KTIIX", 4_000_00, { intl_stocks: 1 }),
  holding("KTBIX", 6_000_00, { bonds: 1 }),
]);

describe("investing by your values", () => {
  it("changes nothing when nothing is listed", () => {
    const p = valuesPlan([BROKERAGE], NONE);
    expect(p.switches).toEqual([]);
    expect(coreFundsFor(NONE)).toMatchObject({ us_stocks: "KTSIX", bonds: "KTBIX" });
  });

  it("picks the cheapest fund that leaves out everything listed, closest if none does", () => {
    expect(fundFor("us_stocks", { excludes: ["fossil_fuels"], themes: [] }).ticker).toBe("KUFFX");
    expect(fundFor("us_stocks", ALL).ticker).toBe("KUSEX");
    expect(fundFor("bonds", ALL).missing).toEqual([]);
  });

  it("keeps every kind of investment exactly where it was: the risk target never moves", () => {
    for (const prefs of [ALL, { excludes: ["tobacco"], themes: ["clean_energy"] } as Prefs]) {
      const p = valuesPlan([BROKERAGE], prefs);
      expect(p.switches.length).toBeGreaterThan(0);
      for (const cls of ["us_stocks", "intl_stocks", "bonds"] as const) {
        expect(p.classTotals[cls].before).toBe(p.classTotals[cls].after);
      }
      for (const s of p.switches) {
        expect(s.legs.reduce((a, l) => a + l.amountCents, 0)).toBe(s.from.valueCents);
      }
    }
  });

  it("states the fee difference in dollars a year", () => {
    const p = valuesPlan([BROKERAGE], ALL);
    // US 3 -> 9 bps on $10,000 = $6; international 8 -> 16 bps on $4,000 = $3.20; bonds 5 -> 11 on $6,000 = $3.60.
    expect(p.feeDeltaCents).toBe(600 + 320 + 360);
  });

  it("shows what it does to diversification", () => {
    const p = valuesPlan([BROKERAGE], ALL);
    const us = p.diversification.find((d) => d.assetClass === "us_stocks")!;
    expect(us.afterHoldings).toBeLessThan(us.beforeHoldings);
    expect(us.keptBps).toBeLessThan(10_000);
  });

  it("adds a theme only as a small tilt inside the same kind, and only if it leaves out the list", () => {
    const prefs: Prefs = { excludes: ["fossil_fuels", "weapons"], themes: ["clean_energy"] };
    expect(tiltFund(prefs)?.ticker).toBe("KUCEX");
    const p = valuesPlan([BROKERAGE], prefs);
    const us = p.switches.find((s) => s.assetClass === "us_stocks")!;
    expect(us.legs.map((l) => l.ticker)).toEqual(["KUSEX", "KUCEX"]);
    expect(us.legs[1].amountCents).toBe(Math.round(10_000_00 * THEME_TILT_SHARE));
    expect(tiltFund({ excludes: [], themes: [] })).toBeNull();
  });

  it("reports the tax on a sale in a taxable account but not in an IRA", () => {
    const ira = account("i", "ira", [holding("KTSIX", 5_000_00, { us_stocks: 1 }, 2_000_00)]);
    const p = valuesPlan([BROKERAGE, ira], ALL);
    expect(
      p.switches.find((s) => s.accountId === "b" && s.assetClass === "us_stocks")!.gainCents,
    ).toBe(4_000_00);
    expect(p.switches.find((s) => s.accountId === "i")!.gainCents).toBeNull();
  });

  it("leaves a workplace plan alone when its menu doesn't offer the screened fund", () => {
    const plan = account("p", "401k", [holding("KTSIX", 5_000_00, { us_stocks: 1 })]);
    const p = valuesPlan([plan], ALL);
    expect(p.switches).toEqual([]);
    expect(p.skipped[0].reason).toMatch(/workplace plan's menu/);
  });

  it("leaves multi-asset funds alone and says so", () => {
    const td = account("t", "ira", [
      holding("NSTDX", 5_000_00, { us_stocks: 0.54, intl_stocks: 0.36, bonds: 0.1 }),
    ]);
    const p = valuesPlan([td], ALL);
    expect(p.switches).toEqual([]);
    expect(p.skipped[0].reason).toMatch(/several kinds/);
  });

  it("gives the same key for the same plan and a new one when it changes", () => {
    const a = valuesPlan([BROKERAGE], ALL).key;
    expect(valuesPlan([BROKERAGE], ALL).key).toBe(a);
    expect(valuesPlan([BROKERAGE], { excludes: ["fossil_fuels"], themes: [] }).key).not.toBe(a);
  });
});
