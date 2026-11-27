import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { estimateTaxes, NO_INCOME } from "@/planning/tax-estimate";
import {
  ALLOWED_SOURCE_HOSTS,
  DRAFT_TAX_YEARS,
  draftParams,
  federalParams,
  NoTaxParamsError,
  PARAMS_VERSION,
  SUPPORTED_TAX_YEARS,
  verifyNotes,
} from "./index";
import type { Bracket, Cited } from "./types";

// The completeness test for the year-keyed tax figures (Tax T1, roadmap part 1.2).

const VERSION_FILE = join(__dirname, "params-version.json");
const $ = (dollars: number) => Math.round(dollars * 100);

// Sorted keys, so the same figures always hash the same.
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );

const groups = (year: number): [string, Cited<unknown>][] =>
  Object.entries(federalParams(year) as unknown as Record<string, unknown>).filter(
    (e): e is [string, Cited<unknown>] =>
      typeof e[1] === "object" && e[1] !== null && "status" in e[1],
  );

// Numbers that are not money in cents: a rate or a share (by the end of the name), and these.
const NOT_MONEY = new Set([
  "obbba.firstYear",
  "obbba.lastYear",
  "obbba.senior.minAge",
  "savers.taxYear",
  "saversMatch.firstYear",
  "rothCatchUp.requiredFrom",
  "eitc.childlessMinAge",
  "eitc.childlessMaxAge",
  "mileage.businessCentsPerMile",
]);
const isNotMoney = (path: string) =>
  /(Rate|rate|Share|share)(\[\d+\])?$/.test(path) ||
  NOT_MONEY.has(path) ||
  /^mileage\.businessByPeriod\[\d+\]\.centsPerMile$/.test(path);

function walk(v: unknown, path: string, visit: (path: string, n: number) => void) {
  if (typeof v === "number") visit(path, v);
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, visit));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, visit);
}

// The groups that carry a note today, by year, and why: a change to a list is a deliberate one.
const EXPECTED_NOTES: Record<number, string[]> = {
  2025: ["savers", "saversMatch", "rothCatchUp"],
  2026: [
    "eitc",
    "selfEmployment",
    "obbba",
    "savers",
    "saversMatch",
    "rothCatchUp",
    "dependentCare",
    "education",
    "energy",
  ],
};
// The groups not read at a primary source (D6: a rule needing one shows no figure).
const EXPECTED_UNCONFIRMED: Record<number, string[]> = { 2025: [], 2026: [] };

describe.each(SUPPORTED_TAX_YEARS)("federal parameters %i", (year) => {
  const params = federalParams(year);

  it("is for the year it is filed under", () => {
    expect(params.year).toBe(year);
  });

  it("has every group, each with a value", () => {
    const keys = groups(year).map(([k]) => k);
    expect(keys.sort()).toEqual(
      [
        "brackets",
        "capitalGains",
        "standardDeduction",
        "additionalStandard",
        "dependentStandard",
        "capitalLoss",
        "ctc",
        "eitc",
        "selfEmployment",
        "payroll",
        "additionalMedicare",
        "netInvestmentIncomeTax",
        "qbi",
        "obbba",
        "savers",
        "saversMatch",
        "rothCatchUp",
        "studentLoanInterest",
        "salt",
        "mortgageDebt",
        "charity",
        "medical",
        "contributionLimits",
        "dependentCare",
        "education",
        "energy",
        "amt",
        "mileage",
        "homeOffice",
      ].sort(),
    );
    for (const [key, g] of groups(year)) {
      expect(g.value, key).not.toBeNull();
      expect(g.value, key).not.toBeUndefined();
    }
  });

  it("gives every group a source on an allow-listed host, a place in it and a date no later than today", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const [key, g] of groups(year)) {
      for (const address of [g.source, ...(g.alsoSources ?? [])]) {
        const url = new URL(address);
        expect(url.protocol, `${key} ${address}`).toBe("https:");
        expect(
          ALLOWED_SOURCE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`)),
          `${key} ${address}`,
        ).toBe(true);
      }
      expect(g.where.length, `${key} where`).toBeGreaterThan(10);
      expect(g.checkedOn, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(g.checkedOn)), key).toBe(false);
      expect(g.checkedOn <= today, `${key} checked in the future`).toBe(true);
      expect(["verified", "draft", "unconfirmed"], key).toContain(g.status);
    }
  });

  it("keeps money in whole cents", () => {
    walk(Object.fromEntries(groups(year).map(([k, g]) => [k, g.value])), "", (path, n) => {
      if (isNotMoney(path)) return;
      expect(Number.isInteger(n), `${path} = ${n}`).toBe(true);
    });
  });

  it("has ascending brackets with rates between 0 and 1, starting at zero", () => {
    for (const set of [params.brackets.value, params.capitalGains.value]) {
      for (const [status, list] of Object.entries(set) as [string, readonly Bracket[]][]) {
        expect(list[0]?.over, status).toBe(0);
        list.forEach((b, i) => {
          expect(b.rate, status).toBeGreaterThanOrEqual(0);
          expect(b.rate, status).toBeLessThanOrEqual(1);
          if (i > 0) {
            expect(b.over, status).toBeGreaterThan(list[i - 1]?.over ?? 0);
            expect(b.rate, status).toBeGreaterThanOrEqual(list[i - 1]?.rate ?? 0);
          }
        });
      }
    }
  });

  it("has every phase-out start below its end", () => {
    for (const range of Object.values(params.studentLoanInterest.value.phaseOut)) {
      if (range) expect(range[0]).toBeLessThan(range[1]);
    }
    for (const range of Object.values(params.education.value.phaseOut)) {
      expect(range[0]).toBeLessThan(range[1]);
    }
    for (const range of Object.values(params.saversMatch.value.phaseOut)) {
      expect(range[0]).toBeLessThan(range[1]);
    }
    const eitc = params.eitc.value;
    for (const from of [eitc.phaseOutFrom.single, eitc.phaseOutFrom.married_joint]) {
      expect(from.length).toBe(4);
      expect(eitc.maxCredit.length).toBe(4);
    }
    expect(params.dependentCare.value.firstStepFrom).toBeLessThan(
      params.dependentCare.value.secondStepFrom.normal,
    );
    const amt = params.amt.value;
    for (const s of ["single", "married_joint", "married_separate", "head_of_household"] as const) {
      expect(amt.exemption[s]).toBeLessThan(amt.phaseOutStart[s]);
    }
  });

  it("matches the fingerprint in params-version.json (change a figure and update it on purpose)", () => {
    const hash = createHash("sha256").update(canonical(params)).digest("hex");
    if (process.env.PARAMS_VERSION_WRITE === "1") {
      const all = JSON.parse(readFileSync(VERSION_FILE, "utf8")) as Record<string, string>;
      writeFileSync(VERSION_FILE, JSON.stringify({ ...all, [year]: hash }, null, 2) + "\n");
      return;
    }
    expect(PARAMS_VERSION[String(year)]).toBe(hash);
  });
});

// A draft year (Tax T32) is not priced, but its figures are fingerprinted and cited the same way.
describe.each(DRAFT_TAX_YEARS)("draft federal parameters %i", (year) => {
  const params = draftParams(year);
  const draftGroups = Object.entries(params as unknown as Record<string, unknown>).filter(
    (e): e is [string, Cited<unknown>] =>
      typeof e[1] === "object" && e[1] !== null && "status" in e[1],
  );

  it("is for the year it is filed under and cites every group on an allow-listed host", () => {
    expect(params.year).toBe(year);
    const today = new Date().toISOString().slice(0, 10);
    for (const [key, g] of draftGroups) {
      for (const address of [g.source, ...(g.alsoSources ?? [])]) {
        const url = new URL(address);
        expect(url.protocol, `${key} ${address}`).toBe("https:");
        expect(
          ALLOWED_SOURCE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`)),
          `${key} ${address}`,
        ).toBe(true);
      }
      expect(g.where.length, `${key} where`).toBeGreaterThan(10);
      expect(g.checkedOn <= today, `${key} checked in the future`).toBe(true);
    }
  });

  it("matches the fingerprint in params-version.json (change a figure and update it on purpose)", () => {
    const hash = createHash("sha256").update(canonical(params)).digest("hex");
    if (process.env.PARAMS_VERSION_WRITE === "1") {
      const all = JSON.parse(readFileSync(VERSION_FILE, "utf8")) as Record<string, string>;
      writeFileSync(VERSION_FILE, JSON.stringify({ ...all, [year]: hash }, null, 2) + "\n");
      return;
    }
    expect(PARAMS_VERSION[String(year)]).toBe(hash);
  });
});

describe.each(SUPPORTED_TAX_YEARS)(
  "what is still not confirmed at the source, %i (reported)",
  (year) => {
    it("lists exactly these groups, each with its note", () => {
      const notes = verifyNotes(year);
      expect(notes.map((n) => n.key).sort()).toEqual([...(EXPECTED_NOTES[year] ?? [])].sort());
      expect(
        notes
          .filter((n) => n.status === "unconfirmed")
          .map((n) => n.key)
          .sort(),
      ).toEqual(EXPECTED_UNCONFIRMED[year]);
      for (const n of notes) expect(n.note.length, n.key).toBeGreaterThan(20);
    });
  },
);

describe("a caller can't change the shared table", () => {
  it("throws when a figure is assigned", () => {
    const params = federalParams(2026);
    expect(() => {
      (params.amt.value as { phaseOutRate: number }).phaseOutRate = 0.25;
    }).toThrow(TypeError);
    expect(federalParams(2026).amt.value.phaseOutRate).toBe(0.5);
  });
});

describe("a year with no figures is refused, never priced with another year's law", () => {
  it("throws NoTaxParamsError for 2024 and 2027", () => {
    for (const year of [2024, 2027]) {
      expect(() => federalParams(year)).toThrow(NoTaxParamsError);
    }
    expect(() => federalParams(2027)).toThrow(/2027/);
  });
});

describe("the figures the roadmap named for T1, read at the source", () => {
  const p = federalParams(2026);
  it("head of household 24% / 32% / 35% edges are $201,750 and $256,200 (Rev. Proc. 2025-32 Table 2)", () => {
    const hoh = p.brackets.value.head_of_household.map((b) => b.over);
    expect(hoh).toEqual([0, $(17_700), $(67_450), $(105_700), $(201_750), $(256_200), $(640_600)]);
    // Single and married separate are $25 higher (Tables 3 and 4), not the same.
    expect(p.brackets.value.single[4]?.over).toBe($(201_775));
    expect(p.brackets.value.married_separate[4]?.over).toBe($(201_775));
  });
  it("the EITC investment income limit is $12,200 and is verified", () => {
    expect(p.eitc.value.investmentIncomeLimit).toBe($(12_200));
    expect(p.eitc.status).toBe("verified");
  });
  it("the child tax credit falls $50 per $1,000 and is verified", () => {
    expect(p.ctc.value.phaseOutPerStep).toBe($(50));
    expect(p.ctc.value.phaseOutStep).toBe($(1_000));
    expect(p.ctc.status).toBe("verified");
  });
  it("AMT 2026 and the mileage rate are read at their sources", () => {
    expect(p.amt.source).toContain("rp-25-32");
    expect(p.mileage.source).toContain("n-26-10");
    expect(p.mileage.value.businessCentsPerMile).toBe(72.5);
  });
  it("the AMT phase-out rate is 50 percent from 2026 (26 USC 55(d)(4)(A)(ii)(IV)) and the exemptions run out where the IRS says", () => {
    expect(p.amt.value.phaseOutRate).toBe(0.5);
    expect(p.amt.status).toBe("verified");
    expect(p.amt.verify).toBeUndefined();
    // Rev. Proc. 2025-32 4.10: complete phase-out at start + exemption / 0.5.
    for (const [s, full] of [
      ["married_joint", $(1_280_400)],
      ["single", $(680_200)],
      ["married_separate", $(640_200)],
    ] as const) {
      expect(
        p.amt.value.phaseOutStart[s] + p.amt.value.exemption[s] / p.amt.value.phaseOutRate,
      ).toBe(full);
    }
    // 2025 law still has 25 percent.
    expect(federalParams(2025).amt.value.phaseOutRate).toBe(0.25);
  });
  it("the Roth catch-up threshold for 2027 catch-ups is $155,000 (Notice 2026-66); 2026's was $150,000", () => {
    expect(p.rothCatchUp.value.overByCatchUpYear).toEqual({ 2026: $(150_000), 2027: $(155_000) });
    expect(p.rothCatchUp.value.priorYearFicaWagesOver).toBe($(155_000));
    expect(p.rothCatchUp.source).toContain("n-26-66");
  });
  it("the mileage rate is 72.5 cents to June 30 and 76 from July 1; undated miles use the first", () => {
    expect(p.mileage.value.businessByPeriod).toEqual([
      { from: "2026-01-01", to: "2026-06-30", centsPerMile: 72.5 },
      { from: "2026-07-01", to: "2026-12-31", centsPerMile: 76 },
    ]);
    expect(p.mileage.value.businessCentsPerMile).toBe(72.5);
    expect(p.mileage.verify).toBeUndefined();
  });
});

// HE-1 (roadmap T1): 2026, single, wages $50,000, nothing else. AGI $50,000; standard $16,100;
// taxable $33,900; tax = 10% x $12,400 + 12% x $21,500 = $1,240 + $2,580 = $3,820.00.
describe("hand example HE-1", () => {
  it("prints 382000 cents", () => {
    const e = estimateTaxes({
      year: 2026,
      filingStatus: "single",
      childrenUnder17: 0,
      otherDependants: 0,
      state: null,
      income: { ...NO_INCOME, wagesCents: $(50_000), socialSecurityWagesCents: $(50_000) },
      studentLoanInterestCents: 0,
      mortgageInterestCents: 0,
      charityCents: 0,
      medicalCents: 0,
      otherStateLocalTaxCents: 0,
      federalWithheldCents: 0,
      federalEstimatedPaidCents: 0,
      stateWithheldCents: 0,
      stateEstimatedPaidCents: 0,
    });
    expect(e.agiCents).toBe($(50_000));
    expect(e.deduction.standardCents).toBe($(16_100));
    expect(e.taxableCents).toBe($(33_900));
    expect(e.incomeTaxCents).toBe(382_000);
  });
});
