import { describe, expect, it } from "vitest";
import type { FilingStatus } from "@/config/tax";
import { taxYearReady } from "@/lib/invariants/nightly";
import {
  DRAFT_TAX_YEARS,
  draftParams,
  federalParams,
  NoTaxParamsError,
  pendingGroups,
  SUPPORTED_TAX_YEARS,
  verifyNotes,
} from "./index";
import type { Bracket, Cited } from "./types";

// Tax T32: the 2027 federal figures, a DRAFT year. Every table is checked against a second
// reading: the "tax is" base amounts of Rev. Proc. 2026-35 section 3.01 (a different column from
// the thresholds typed into the file), the EITC table's own arithmetic, the AMT phase-out
// arithmetic, and the Code. One group (the mileage rate) is not published, so the year is not in
// SUPPORTED_TAX_YEARS and nothing can price with it.

const p = draftParams(2027);
const $ = (dollars: number) => Math.round(dollars * 100);
const STATUSES: FilingStatus[] = [
  "single",
  "married_joint",
  "married_separate",
  "head_of_household",
];

function taxOn(list: readonly Bracket[], taxable: number): number {
  let tax = 0;
  list.forEach((b, i) => {
    const top = list[i + 1]?.over ?? Infinity;
    if (taxable > b.over) tax += (Math.min(taxable, top) - b.over) * b.rate;
  });
  return Math.round(tax);
}
const tax = (status: FilingStatus, taxableCents: number) =>
  taxOn(p.brackets.value[status], taxableCents);

describe("2027 is a draft year, refused by the estimator's lookup", () => {
  it("is not supported and federalParams refuses it", () => {
    expect(SUPPORTED_TAX_YEARS).not.toContain(2027);
    expect(DRAFT_TAX_YEARS).toEqual([2027]);
    expect(() => federalParams(2027)).toThrow(NoTaxParamsError);
    expect(p.year).toBe(2027);
  });

  it("has the same groups as 2026", () => {
    expect(Object.keys(p).sort()).toEqual(Object.keys(federalParams(2026)).sort());
  });

  it("has exactly one group not final: the mileage rate, zero and unconfirmed, never copied from 2026", () => {
    expect(
      pendingGroups()
        .filter((g) => g.year === 2027)
        .map((g) => g.key),
    ).toEqual(["mileage"]);
    expect(p.mileage.status).toBe("unconfirmed");
    expect(p.mileage.value).toEqual({ businessCentsPerMile: 0, businessByPeriod: [] });
    expect(p.mileage.verify).toMatch(/AWAITED/);
    for (const [key, group] of Object.entries(p)) {
      if (key === "year" || key === "mileage") continue;
      expect((group as Cited<unknown>).status, key).toBe("verified");
    }
  });

  it("lists the groups that carry a note, so a new one is a visible change", () => {
    expect(
      verifyNotes(2027)
        .map((n) => n.key)
        .sort(),
    ).toEqual(
      [
        "dependentCare",
        "mileage",
        "obbba",
        "rothCatchUp",
        "savers",
        "saversMatch",
        "selfEmployment",
      ].sort(),
    );
  });

  it("keeps the nightly check warning, naming what is awaited, until the year is supported", () => {
    const r = taxYearReady("2026-12-01");
    expect(r.state).toBe("warning");
    expect(r.messages[0]).toBe(
      "No tax figures for 2027 yet; 2027 starts soon (a draft file exists; not final: mileage)",
    );
    expect(taxYearReady("2027-01-01").state).toBe("red");
  });
});

describe("ordinary brackets against the Rev. Proc. 2026-35 base amounts (the 'tax is' column)", () => {
  // [bracket start in dollars, tax at that start in dollars]
  const bases: Record<FilingStatus, [number, number][]> = {
    single: [
      [12_800, 1_280],
      [52_025, 5_987],
      [109_125, 18_549],
      [208_325, 42_357],
      [264_550, 60_349],
      [661_375, 199_237.75],
    ],
    married_joint: [
      [25_600, 2_560],
      [104_050, 11_974],
      [218_250, 37_098],
      [416_650, 84_714],
      [529_100, 120_698],
      [793_650, 213_290.5],
    ],
    married_separate: [
      [12_800, 1_280],
      [52_025, 5_987],
      [109_125, 18_549],
      [208_325, 42_357],
      [264_550, 60_349],
      [396_825, 106_645.25],
    ],
    head_of_household: [
      [18_250, 1_825],
      [69_650, 7_993],
      [109_100, 16_672],
      [208_300, 40_480],
      [264_550, 58_480],
      [661_350, 197_360],
    ],
  };
  for (const status of STATUSES) {
    it(`${status}: the tax at each bracket edge is the published base amount`, () => {
      expect(p.brackets.value[status].length).toBe(7);
      for (const [start, base] of bases[status])
        expect(tax(status, $(start)), `${status} ${start}`).toBe($(base));
    });
  }

  it("rates are 10, 12, 22, 24, 32, 35, 37 for every status", () => {
    for (const status of STATUSES) {
      expect(p.brackets.value[status].map((b) => b.rate)).toEqual([
        0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37,
      ]);
    }
  });
});

describe("one hand example per filing status: taxable income $40,000", () => {
  // Worked by hand from the Rev. Proc. 2026-35 tables (and equal to the code's own output):
  // single / separate: 10% x 12,800 = 1,280; 12% x (40,000 - 12,800 = 27,200) = 3,264; total 4,544.00
  // joint: 10% x 25,600 = 2,560; 12% x (40,000 - 25,600 = 14,400) = 1,728; total 4,288.00
  // head of household: 10% x 18,250 = 1,825; 12% x (40,000 - 18,250 = 21,750) = 2,610; total 4,435.00
  const cases: [FilingStatus, number][] = [
    ["single", 4_544],
    ["married_separate", 4_544],
    ["married_joint", 4_288],
    ["head_of_household", 4_435],
  ];
  for (const [status, expected] of cases) {
    it(`${status}: $${expected}.00`, () => {
      expect(tax(status, $(40_000))).toBe($(expected));
    });
  }

  it("one gain example per status: ordinary income $40,000, gains and dividends on top", () => {
    // The 0% band ends at 51,050 single (and separate), 102,100 joint, 68,350 head of household.
    for (const [status, zeroTo] of [
      ["single", 51_050],
      ["married_separate", 51_050],
      ["married_joint", 102_100],
      ["head_of_household", 68_350],
    ] as const) {
      const list = p.capitalGains.value[status];
      expect(list[1]?.over).toBe($(zeroTo));
      expect(list.map((b) => b.rate)).toEqual([0, 0.15, 0.2]);
    }
    // The 20% edges.
    expect(p.capitalGains.value.single[2]?.over).toBe($(563_200));
    expect(p.capitalGains.value.married_joint[2]?.over).toBe($(633_600));
    expect(p.capitalGains.value.married_separate[2]?.over).toBe($(316_800));
    expect(p.capitalGains.value.head_of_household[2]?.over).toBe($(598_400));
  });
});

describe("the other tables against their own arithmetic", () => {
  it("standard deduction and the aged or blind amounts", () => {
    expect(p.standardDeduction.value).toEqual({
      single: $(16_600),
      married_joint: $(33_200),
      married_separate: $(16_600),
      head_of_household: $(24_925),
    });
    expect(p.additionalStandard.value).toEqual({ unmarried: $(2_100), married: $(1_700) });
    expect(p.dependentStandard.value).toEqual({ floor: $(1_400), plusEarned: $(500) });
  });

  it("the EITC maximum is the rate times the earned income amount, and each completed phase-out is the threshold plus the maximum over the phase-out rate", () => {
    const e = p.eitc.value;
    // Earned income amounts from section 3.06(1): 8,960 / 13,450 / 18,880 / 18,880.
    const earned = [8_960, 13_450, 18_880, 18_880];
    // Completed phase-out amounts from the same table: [other, joint] by number of children.
    const completed = [
      [20_164, 27_684],
      [53_277, 60_787],
      [60_519, 68_029],
      [65_002, 72_512],
    ] as const;
    for (let i = 0; i < 4; i++) {
      expect(Math.round(e.phaseInRate[i]! * earned[i]!), `max ${i}`).toBe(e.maxCredit[i]! / 100);
      const single = e.phaseOutFrom.single[i]! + e.maxCredit[i]! / e.phaseOutRate[i]!;
      const joint = e.phaseOutFrom.married_joint[i]! + e.maxCredit[i]! / e.phaseOutRate[i]!;
      expect(Math.round(single / 100), `single ${i}`).toBe(completed[i]![0]);
      expect(Math.round(joint / 100), `joint ${i}`).toBe(completed[i]![1]);
    }
    expect(e.investmentIncomeLimit).toBe($(12_600));
    expect([e.childlessMinAge, e.childlessMaxAge]).toEqual([25, 64]);
  });

  it("the AMT phase-out is complete at the published amounts", () => {
    const a = p.amt.value;
    for (const [s, full] of [
      ["married_joint", $(1_321_300)],
      ["single", $(701_950)],
      ["married_separate", $(660_650)],
      ["head_of_household", $(701_950)],
    ] as const) {
      expect(a.phaseOutStart[s] + a.exemption[s] / a.phaseOutRate, s).toBe(full);
    }
    expect(a.highRateFrom.married_separate * 2).toBe(a.highRateFrom.single);
    expect(a.phaseOutRate).toBe(0.5);
  });

  it("the child tax credit and the refundable part are the indexed amounts", () => {
    expect(p.ctc.value.perChild).toBe($(2_300));
    expect(p.ctc.value.refundablePerChild).toBe($(1_800));
    expect(p.ctc.value.otherDependant).toBe($(500));
    expect(p.ctc.value.earnedIncomeFloor).toBe($(2_500));
  });

  it("the SALT cap is 101 percent of 2026's, the threshold too, and separate returns get half", () => {
    const s26 = federalParams(2026).salt.value;
    const s = p.salt.value;
    expect(s.cap.normal).toBe(Math.round(s26.cap.normal * 1.01));
    expect(s.phaseDownFrom.normal).toBe(Math.round(s26.phaseDownFrom.normal * 1.01));
    expect(s.cap.marriedSeparate * 2).toBe(s.cap.normal);
    expect(s.phaseDownFrom.marriedSeparate * 2).toBe(s.phaseDownFrom.normal);
    expect(s.cap.normal).toBe($(40_804));
    expect(s.phaseDownFrom.normal).toBe($(510_050));
    expect(s.floor.normal).toBe($(10_000));
  });

  it("the QBI thresholds, student loan ranges and the HSA, 401(k) and IRA limits", () => {
    expect(p.qbi.value.threshold).toEqual({
      single: $(208_300),
      married_joint: $(416_600),
      married_separate: $(208_325),
      head_of_household: $(208_300),
    });
    expect(p.studentLoanInterest.value.phaseOut.single).toEqual([$(90_000), $(105_000)]);
    expect(p.studentLoanInterest.value.phaseOut.married_joint).toEqual([$(180_000), $(210_000)]);
    expect(p.studentLoanInterest.value.phaseOut.married_separate).toBeNull();
    const c = p.contributionLimits.value;
    expect([c.workplace, c.workplaceCatchUp50, c.workplaceCatchUp60to63]).toEqual([
      $(25_500),
      $(8_500),
      $(11_750),
    ]);
    expect([c.hsaSelf, c.hsaFamily, c.healthFsa, c.ira]).toEqual([
      $(4_500),
      $(9_000),
      $(3_500),
      $(7_500),
    ]);
  });

  it("the Social Security wage base is the notice's, and the saver's credit limits step 1.5 times for head of household", () => {
    expect(p.selfEmployment.value.wageBase).toBe($(192_300));
    // 192,353.14 (the notice's unrounded figure) rounds down to a multiple of 300.
    expect(60_600 * (72_800.33 / 22_935.42)).toBeCloseTo(192_353.14, 1);
    expect((p.selfEmployment.value.wageBase / 100) % 300).toBe(0);
    const s = p.savers.value.agiLimit;
    expect(s.married_joint).toBe($(83_000));
    expect(s.head_of_household).toBe($(62_250));
    expect(s.single).toBe($(41_500));
    expect(s.head_of_household * 2).toBe(s.married_joint * 1.5);
  });
});
