import { describe, expect, it } from "vitest";
import { STATE_TAX } from "@/config/tax-rates";
import { CONVENIENCE_RULE_STATES, LOCAL_TAXES, STATE_SOURCES } from "@/config/tax-states";
import { NO_INCOME, estimateTaxes, type EstimateInput } from "./tax-estimate";
import {
  residencePeriods,
  residentTax,
  stateParts,
  wagesByPeriod,
  workStateTaxesRemoteWages,
} from "./tax-states";

const who = { filingStatus: "single" as const, childrenUnder17: 0, otherDependants: 0 };

// Twelve equal paychecks on the 15th.
const monthly = (cents: number) =>
  Array.from({ length: 12 }, (_, i) => ({
    date: `2026-${String(i + 1).padStart(2, "0")}-15`,
    cents,
  }));

const input = (over: Partial<EstimateInput> = {}): EstimateInput => ({
  year: 2026,
  filingStatus: "single",
  childrenUnder17: 0,
  otherDependants: 0,
  state: "CA",
  income: { ...NO_INCOME, wagesCents: 12_000_000, socialSecurityWagesCents: 12_000_000 },
  studentLoanInterestCents: 0,
  mortgageInterestCents: 0,
  charityCents: 0,
  medicalCents: 0,
  otherStateLocalTaxCents: 0,
  federalWithheldCents: 0,
  federalEstimatedPaidCents: 0,
  stateWithheldCents: 0,
  stateEstimatedPaidCents: 0,
  ...over,
});

describe("where the person lived", () => {
  it("is one state all year without moves", () => {
    expect(residencePeriods(2026, "CA", [])).toEqual([
      { state: "CA", from: "2026-01-01", to: "2026-12-31", days: 365 },
    ]);
    expect(residencePeriods(2026, null, [])).toEqual([]);
  });

  it("splits the year at each move, ignoring moves outside it", () => {
    expect(
      residencePeriods(2026, "NY", [
        { date: "2026-07-01", from: "CA", to: "NY" },
        { date: "2025-03-01", from: "TX", to: "CA" },
      ]),
    ).toEqual([
      { state: "CA", from: "2026-01-01", to: "2026-06-30", days: 181 },
      { state: "NY", from: "2026-07-01", to: "2026-12-31", days: 184 },
    ]);
  });
});

describe("a mid-year move", () => {
  const moves = [{ date: "2026-07-01", from: "CA", to: "TX" }];
  const periods = residencePeriods(2026, "TX", moves);

  it("puts each paycheck's wages in the state lived in on payday", () => {
    // Six paydays in California, six in Texas.
    expect(wagesByPeriod(periods, 12_000_000, monthly(800_000))).toEqual([6_000_000, 6_000_000]);
    // Paydays so far only to May: the rest of the year by days in each state after it.
    const soFar = monthly(800_000).slice(0, 5);
    const [ca, tx] = wagesByPeriod(periods, 12_000_000, soFar);
    expect(ca + tx).toBe(12_000_000);
    expect(tx).toBeGreaterThan(ca);
  });

  it("splits income correctly: wages by payday, other income by days", () => {
    const { parts, local } = stateParts({
      year: 2026,
      state: "TX",
      residency: { moves, workState: null, locality: null, paydays: monthly(800_000) },
      who,
      agiCents: 12_365_000,
      wagesCents: 12_000_000,
    });
    expect(local).toBeNull();
    expect(parts.map((p) => [p.code, p.residence, p.from, p.to])).toEqual([
      ["CA", "part_year", "2026-01-01", "2026-06-30"],
      ["TX", "part_year", "2026-07-01", "2026-12-31"],
    ]);
    // $3,650 of interest: 181 days of it in California, 184 in Texas.
    expect(parts[0].incomeCents).toBe(6_000_000 + 181_000);
    expect(parts[1].incomeCents).toBe(6_000_000 + 184_000);
    // California taxes its share of the tax on all the income; Texas has none.
    const full = residentTax("CA", 12_365_000, who)!.taxCents;
    expect(parts[0].taxCents).toBe(Math.round((full * 6_181_000) / 12_365_000));
    expect(parts[1].taxCents).toBe(0);
  });

  it("totals in the estimate under the state lived in at the year's end", () => {
    const e = estimateTaxes(
      input({
        state: "TX",
        residency: { moves, workState: null, locality: null, paydays: monthly(1_000_000) },
      }),
    );
    expect(e.state!.code).toBe("TX");
    expect(e.state!.parts.map((p) => p.code)).toEqual(["CA", "TX"]);
    expect(e.state!.taxCents).toBe(e.state!.parts[0].taxCents);
    // About half of a full year in California.
    const allYear = estimateTaxes(input()).state!.taxCents;
    expect(e.state!.taxCents).toBeGreaterThan(allYear * 0.45);
    expect(e.state!.taxCents).toBeLessThan(allYear * 0.55);
  });

  it("matches the one-state estimate when there's no move", () => {
    const e = estimateTaxes(input()).state!;
    expect(e.parts).toHaveLength(1);
    expect(e.parts[0]).toMatchObject({ code: "CA", residence: "full_year", share: 1 });
    expect(e.taxCents).toBe(residentTax("CA", estimateTaxes(input()).agiCents, who)!.taxCents);
  });
});

describe("remote work for an employer in another state", () => {
  it("knows which states tax remote wages", () => {
    expect(workStateTaxesRemoteWages("NY", "NJ")).toBe(true);
    expect(workStateTaxesRemoteWages("CA", "NV")).toBe(false);
    expect(workStateTaxesRemoteWages("NY", "NY")).toBe(false);
    expect(workStateTaxesRemoteWages(null, "NJ")).toBe(false);
  });

  it("taxes the wages in the work state and credits it at home", () => {
    const { parts } = stateParts({
      year: 2026,
      state: "CT",
      residency: { moves: [], workState: "NY", locality: null },
      who,
      agiCents: 12_000_000,
      wagesCents: 12_000_000,
    });
    const [ct, ny] = parts;
    expect(ny).toMatchObject({ code: "NY", residence: "nonresident", incomeCents: 12_000_000 });
    expect(ny.taxCents).toBe(residentTax("NY", 12_000_000, who)!.taxCents);
    // Connecticut's credit is its own tax on those wages or New York's, whichever is less.
    const ctFull = residentTax("CT", 12_000_000, who)!.taxCents;
    expect(ct.creditCents).toBe(Math.min(ctFull, ny.taxCents));
    expect(ct.taxCents).toBe(ctFull - ct.creditCents);
  });

  it("leaves a remote worker to their home state when the work state has no such rule", () => {
    const { parts } = stateParts({
      year: 2026,
      state: "NV",
      residency: { moves: [], workState: "CA", locality: null },
      who,
      agiCents: 12_000_000,
      wagesCents: 12_000_000,
    });
    expect(parts.map((p) => p.code)).toEqual(["NV"]);
  });
});

describe("local income taxes", () => {
  it("adds New York City's tax for a resident", () => {
    const e = estimateTaxes(
      input({ state: "NY", residency: { moves: [], workState: null, locality: "nyc" } }),
    ).state!;
    expect(e.local).toMatchObject({ key: "nyc", label: "New York City", state: "NY" });
    expect(e.local!.taxCents).toBeGreaterThan(300_000);
    expect(e.taxCents).toBe(e.parts[0].taxCents + e.local!.taxCents);
  });

  it("only counts the months lived there", () => {
    const allYear = estimateTaxes(
      input({ state: "PA", residency: { moves: [], workState: null, locality: "philadelphia" } }),
    ).state!.local!.taxCents;
    const half = estimateTaxes(
      input({
        state: "PA",
        residency: {
          moves: [{ date: "2026-07-01", from: "NJ", to: "PA" }],
          workState: null,
          locality: "philadelphia",
          paydays: monthly(1_000_000),
        },
      }),
    ).state!.local!.taxCents;
    expect(allYear).toBe(Math.round(12_000_000 * 0.0374));
    expect(half).toBe(Math.round(6_000_000 * 0.0374));
  });

  it("ignores a city in a state the person didn't live in", () => {
    const e = estimateTaxes(
      input({ state: "CA", residency: { moves: [], workState: null, locality: "detroit" } }),
    ).state!;
    expect(e.local).toBeNull();
  });
});

describe("every state's figures cite their source", () => {
  it("has a tax agency for every state and DC, with its own web address", () => {
    expect(Object.keys(STATE_SOURCES).sort()).toEqual(Object.keys(STATE_TAX).sort());
    expect(Object.keys(STATE_TAX)).toHaveLength(51);
    for (const [code, s] of Object.entries(STATE_SOURCES)) {
      expect(s.agency, code).not.toBe("");
      expect(s.url, code).toMatch(/^https:\/\//);
      expect(STATE_TAX[code].source, code).not.toBe("");
    }
  });

  it("marks the states whose schedules are still to add, and only those", () => {
    for (const [code, rules] of Object.entries(STATE_TAX)) {
      expect(Boolean(STATE_SOURCES[code].toAdd), code).toBe(rules.kind === "approximate");
    }
  });

  it("cites a source for every local tax, in a state Jane knows", () => {
    for (const [key, local] of Object.entries(LOCAL_TAXES)) {
      expect(STATE_TAX[local.state], key).toBeDefined();
      expect(local.url, key).toMatch(/^https:\/\//);
      expect(local.source, key).not.toBe("");
      expect(local.rate !== undefined || local.brackets !== undefined, key).toBe(true);
    }
    for (const code of CONVENIENCE_RULE_STATES) expect(STATE_TAX[code], code).toBeDefined();
  });
});
