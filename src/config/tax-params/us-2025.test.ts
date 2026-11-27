import { describe, expect, it } from "vitest";
import type { FilingStatus } from "@/config/tax";
import { federalParams } from "./index";
import type { Bracket } from "./types";

// Tax T3: the 2025 federal figures checked against a SECOND reading. Every table below was typed
// from a different document than the one us-2025.ts cites: the 2025 Form 1040 instructions (Tax
// Table, Tax Computation Worksheet, EIC Table, the capital gain and AMT notes), Form 2441's line 8
// table, and the "tax is" base amounts of Rev. Proc. 2024-40. A figure typed wrong in one place
// fails here. Nothing in the estimator reads 2025 yet (that is Tax T4).

const p = federalParams(2025);
const $ = (dollars: number) => Math.round(dollars * 100);
const STATUSES: FilingStatus[] = [
  "single",
  "married_joint",
  "married_separate",
  "head_of_household",
];

// Tax on a taxable income (cents), by the bracket list.
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

describe("ordinary brackets against the Rev. Proc. 2024-40 base amounts (the 'tax is' column)", () => {
  // [bracket start in dollars, tax at that start in dollars]
  const bases: Record<FilingStatus, [number, number][]> = {
    single: [
      [11_925, 1_192.5],
      [48_475, 5_578.5],
      [103_350, 17_651],
      [197_300, 40_199],
      [250_525, 57_231],
      [626_350, 188_769.75],
    ],
    married_joint: [
      [23_850, 2_385],
      [96_950, 11_157],
      [206_700, 35_302],
      [394_600, 80_398],
      [501_050, 114_462],
      [751_600, 202_154.5],
    ],
    married_separate: [
      [11_925, 1_192.5],
      [48_475, 5_578.5],
      [103_350, 17_651],
      [197_300, 40_199],
      [250_525, 57_231],
      [375_800, 101_077.25],
    ],
    head_of_household: [
      [17_000, 1_700],
      [64_850, 7_442],
      [103_350, 15_912],
      [197_300, 38_460],
      [250_500, 55_484],
      [626_350, 187_031.5],
    ],
  };
  it.each(STATUSES)("%s: each edge and the tax at it", (status) => {
    const list = p.brackets.value[status];
    expect(list.map((b) => b.over)).toEqual([0, ...bases[status].map(([edge]) => $(edge))]);
    for (const [edge, base] of bases[status]) expect(tax(status, $(edge)), `${edge}`).toBe($(base));
  });
});

describe("the 2025 Form 1040 instructions' Tax Computation Worksheet (income of $100,000 or more)", () => {
  // [filing status, from, to, rate, subtraction amount]: tax = taxable x rate - subtraction.
  const rows: [FilingStatus, number, number, number, number][] = [
    ["single", 100_000, 103_350, 0.22, 5_086],
    ["single", 103_350, 197_300, 0.24, 7_153],
    ["single", 197_300, 250_525, 0.32, 22_937],
    ["single", 250_525, 626_350, 0.35, 30_452.75],
    ["single", 626_350, 900_000, 0.37, 42_979.75],
    ["married_joint", 100_000, 206_700, 0.22, 10_172],
    ["married_joint", 206_700, 394_600, 0.24, 14_306],
    ["married_joint", 394_600, 501_050, 0.32, 45_874],
    ["married_joint", 501_050, 751_600, 0.35, 60_905.5],
    ["married_joint", 751_600, 900_000, 0.37, 75_937.5],
    ["married_separate", 100_000, 103_350, 0.22, 5_086],
    ["married_separate", 103_350, 197_300, 0.24, 7_153],
    ["married_separate", 197_300, 250_525, 0.32, 22_937],
    ["married_separate", 250_525, 375_800, 0.35, 30_452.75],
    ["married_separate", 375_800, 900_000, 0.37, 37_968.75],
    ["head_of_household", 100_000, 103_350, 0.22, 6_825],
    ["head_of_household", 103_350, 197_300, 0.24, 8_892],
    ["head_of_household", 197_300, 250_500, 0.32, 24_676],
    ["head_of_household", 250_500, 626_350, 0.35, 32_191],
    ["head_of_household", 626_350, 900_000, 0.37, 44_718],
  ];
  it.each(rows)("%s from %d to %d", (status, from, to, rate, sub) => {
    for (const x of [from, Math.floor((from + to) / 2), to]) {
      expect(tax(status, $(x)), `${x}`).toBe(Math.round($(x) * rate - $(sub)));
    }
  });
});

describe("the 2025 Form 1040 instructions' Tax Table (rows under $100,000, tax at the row's middle)", () => {
  // [at least, but less than, single, married joint, married separate, head of household]
  const rows: [number, number, number, number, number, number][] = [
    [11_900, 11_950, 1_193, 1_193, 1_193, 1_193],
    [11_950, 12_000, 1_199, 1_198, 1_199, 1_198],
    [20_000, 20_050, 2_165, 2_003, 2_165, 2_063],
    [25_300, 25_350, 2_801, 2_562, 2_801, 2_699],
    [34_250, 34_300, 3_875, 3_636, 3_875, 3_773],
    [42_000, 42_050, 4_805, 4_566, 4_805, 4_703],
    [48_300, 48_350, 5_561, 5_322, 5_561, 5_459],
    [50_000, 50_050, 5_920, 5_526, 5_920, 5_663],
    [60_000, 60_050, 8_120, 6_726, 8_120, 6_863],
    [69_000, 69_050, 10_100, 7_806, 10_100, 8_361],
    [75_000, 75_050, 11_420, 8_526, 11_420, 9_681],
    [99_950, 100_000, 16_909, 11_823, 16_909, 15_170],
  ];
  it.each(rows)("%d to %d", (lo, hi, ...expected) => {
    STATUSES.forEach((status, i) => {
      const middle = $((lo + hi) / 2);
      // The IRS rounds the tax at the middle to the nearest whole dollar, halves up.
      expect(Math.round(tax(status, middle) / 100), status).toBe(expected[i]);
    });
  });
});

describe("hand example HE-2 (roadmap T3): wages less the 2025 standard deduction, one per filing status", () => {
  // Taxable income $34,250 for every status. The schedule gives the exact tax; the Tax Table row
  // ($34,250 to $34,300) is the tax at its middle, $34,275, so it is a few dollars higher.
  const cases: [FilingStatus, number, number, number][] = [
    // status, wages, exact tax in dollars, the IRS Tax Table row's figure
    ["single", 50_000, 1_192.5 + 0.12 * (34_250 - 11_925), 3_875], // 3,871.50
    ["married_joint", 65_750, 2_385 + 0.12 * (34_250 - 23_850), 3_636], // 3,633.00
    ["married_separate", 50_000, 1_192.5 + 0.12 * (34_250 - 11_925), 3_875], // 3,871.50
    ["head_of_household", 57_875, 1_700 + 0.12 * (34_250 - 17_000), 3_773], // 3,770.00
  ];
  it.each(cases)("%s with wages of $%d", (status, wages, exactDollars, tableRow) => {
    const taxable = Math.max(0, $(wages) - p.standardDeduction.value[status]);
    expect(taxable).toBe($(34_250));
    expect(tax(status, taxable)).toBe($(exactDollars));
    expect(Math.round(tax(status, $(34_275)) / 100)).toBe(tableRow);
  });
  it("single, wages $50,000: standard $15,750, taxable $34,250, tax $3,871.50", () => {
    expect(p.standardDeduction.value.single).toBe($(15_750));
    expect(tax("single", $(50_000) - p.standardDeduction.value.single)).toBe(387_150);
  });
  it("the worked example in the instructions: a joint couple with taxable income $25,300 owes $2,562", () => {
    expect(Math.round(tax("married_joint", $(25_325)) / 100)).toBe(2_562);
  });
});

describe("standard deduction and the other 2025-law figures, second reading", () => {
  it("is $15,750 / $31,500 / $15,750 / $23,625 (Rev. Proc. 2025-32 3.01; the 1040 instructions agree), not the $15,000 of Rev. Proc. 2024-40", () => {
    expect(p.standardDeduction.value).toEqual({
      single: $(15_750),
      married_joint: $(31_500),
      married_separate: $(15_750),
      head_of_household: $(23_625),
    });
    expect(p.additionalStandard.value).toEqual({ unmarried: $(2_000), married: $(1_600) });
  });
  it("capital gains edges: $48,350 / $96,700 / $64,750 and $533,400 / $300,000 / $600,050 / $566,700 (the 1040 worksheet)", () => {
    const edges = (s: FilingStatus) => p.capitalGains.value[s].map((b) => b.over / 100);
    expect(edges("single")).toEqual([0, 48_350, 533_400]);
    expect(edges("married_separate")).toEqual([0, 48_350, 300_000]);
    expect(edges("married_joint")).toEqual([0, 96_700, 600_050]);
    expect(edges("head_of_household")).toEqual([0, 64_750, 566_700]);
    expect(p.capitalGains.value.single.map((b) => b.rate)).toEqual([0, 0.15, 0.2]);
  });
  it("AMT: exemption $88,100 / $137,000 / $68,500 and phase-out from $626,350 / $1,252,700 (the 1040 instructions' AMT note)", () => {
    const { exemption, phaseOutStart, phaseOutRate, highRateFrom } = p.amt.value;
    expect(exemption.single).toBe($(88_100));
    expect(exemption.head_of_household).toBe($(88_100));
    expect(exemption.married_joint).toBe($(137_000));
    expect(exemption.married_separate).toBe($(68_500));
    expect(phaseOutStart.single).toBe($(626_350));
    expect(phaseOutStart.married_joint).toBe($(1_252_700));
    expect(phaseOutStart.married_separate).toBe($(626_350));
    // 2025 is the last year of the 25 percent phase-out (the 50 percent starts in 2026).
    expect(phaseOutRate).toBe(0.25);
    expect(highRateFrom.single).toBe($(239_100));
    expect(highRateFrom.married_separate).toBe($(119_550));
  });
  it("SALT cap $40,000 / $20,000 over $500,000 / $250,000; no charity floor and no non-itemizer deduction yet", () => {
    expect(p.salt.value.cap).toEqual({ normal: $(40_000), marriedSeparate: $(20_000) });
    expect(p.salt.value.phaseDownFrom).toEqual({
      normal: $(500_000),
      marriedSeparate: $(250_000),
    });
    expect(p.charity.value.floorShare).toBe(0);
    expect(p.charity.value.nonItemizer).toEqual({ normal: 0, marriedJoint: 0 });
  });
  it("the child tax credit is $2,200 ($1,700 refundable) and falls $50 per $1,000 over $200,000 / $400,000", () => {
    expect(p.ctc.value.perChild).toBe($(2_200));
    expect(p.ctc.value.refundablePerChild).toBe($(1_700));
    expect(p.ctc.value.phaseOutFrom.married_joint).toBe($(400_000));
    expect(p.ctc.value.phaseOutFrom.single).toBe($(200_000));
  });
  it("Social Security wage base $176,100, student loan ranges, saver's limits and 2025 limits", () => {
    expect(p.selfEmployment.value.wageBase).toBe($(176_100));
    expect(p.studentLoanInterest.value.phaseOut.single).toEqual([$(85_000), $(100_000)]);
    expect(p.studentLoanInterest.value.phaseOut.married_joint).toEqual([$(170_000), $(200_000)]);
    expect(p.savers.value.agiLimit).toEqual({
      single: $(39_500),
      married_separate: $(39_500),
      head_of_household: $(59_250),
      married_joint: $(79_000),
    });
    expect(p.contributionLimits.value.workplace).toBe($(23_500));
    expect(p.contributionLimits.value.ira).toBe($(7_000));
    expect(p.contributionLimits.value.hsaSelf).toBe($(4_300));
    expect(p.contributionLimits.value.hsaFamily).toBe($(8_550));
    expect(p.contributionLimits.value.dependentCareFsa).toBe($(5_000));
    expect(p.mileage.value.businessCentsPerMile).toBe(70);
  });
  it("the Roth catch-up wage threshold by catch-up year: $145,000, $150,000, $155,000", () => {
    expect(p.rothCatchUp.value.overByCatchUpYear).toEqual({
      2025: $(145_000),
      2026: $(150_000),
      2027: $(155_000),
    });
    expect(p.rothCatchUp.value.priorYearFicaWagesOver).toBe($(145_000));
  });
});

describe("the earned income credit against the 2025 Form 1040 instructions' EIC Table", () => {
  const e = p.eitc.value;
  // Credit for children 0 to 3 at an income (the table's row middle), whole dollars, halves up.
  const credit = (joint: boolean, kids: number, lo: number, hi: number) => {
    const middle = (lo + hi) / 2;
    const max = e.maxCredit[kids] ?? 0;
    const rate = e.phaseInRate[kids] ?? 0;
    // A row that contains the earned income amount shows the maximum credit.
    const phasedIn = hi * 100 * rate >= max ? max : middle * 100 * rate;
    const from = (joint ? e.phaseOutFrom.married_joint : e.phaseOutFrom.single)[kids] ?? 0;
    const out = Math.max(0, middle * 100 - from) * (e.phaseOutRate[kids] ?? 0);
    return Math.round(Math.max(0, phasedIn - out) / 100);
  };
  // [at least, less than, single/head of household x 4 (0 to 3 children), married joint x 4]
  const rows: [number, number, number[], number[]][] = [
    [5_000, 5_050, [384, 1_709, 2_010, 2_261], [384, 1_709, 2_010, 2_261]],
    [10_600, 10_650, [649, 3_613, 4_250, 4_781], [649, 3_613, 4_250, 4_781]],
    [12_700, 12_750, [488, 4_328, 5_090, 5_726], [649, 4_328, 5_090, 5_726]],
    [17_850, 17_900, [94, 4_328, 7_152, 8_046], [638, 4_328, 7_152, 8_046]],
    [20_000, 20_050, [0, 4_328, 7_152, 8_046], [473, 4_328, 7_152, 8_046]],
    [25_300, 25_350, [0, 4_012, 6_736, 7_630], [68, 4_328, 7_152, 8_046]],
    [34_250, 34_300, [0, 2_582, 4_851, 5_745], [0, 3_720, 6_351, 7_245]],
    [45_000, 45_050, [0, 864, 2_587, 3_481], [0, 2_002, 4_087, 4_981]],
    [57_500, 57_550, [0, 0, 0, 849], [0, 5, 1_454, 2_348]],
    [61_500, 61_550, [0, 0, 0, 6], [0, 0, 612, 1_506]],
  ];
  it.each(rows)("%d to %d", (lo, hi, single, joint) => {
    [0, 1, 2, 3].forEach((kids) => {
      expect(credit(false, kids, lo, hi), `single, ${kids} children`).toBe(single[kids]);
      expect(credit(true, kids, lo, hi), `joint, ${kids} children`).toBe(joint[kids]);
    });
  });
  it("the completed phase-out amounts of Rev. Proc. 2024-40 follow from the maximum, rate and threshold", () => {
    // [children, single completed phase-out, joint completed phase-out] in dollars.
    for (const [kids, single, joint] of [
      [0, 19_104, 26_214],
      [1, 50_434, 57_554],
      [2, 57_310, 64_430],
      [3, 61_555, 68_675],
    ] as const) {
      const max = e.maxCredit[kids] ?? 0;
      const rate = e.phaseOutRate[kids] ?? 0;
      expect((e.phaseOutFrom.single[kids] ?? 0) + max / rate).toBeCloseTo(single * 100, -2);
      expect((e.phaseOutFrom.married_joint[kids] ?? 0) + max / rate).toBeCloseTo(joint * 100, -2);
    }
  });
});

describe("the child and dependent care credit before 2026, against the 2025 Form 2441 line 8 table", () => {
  const c = p.dependentCare.value;
  const share = (agi: number) =>
    Math.max(
      c.middleShare,
      c.topShare - Math.ceil(Math.max(0, $(agi) - c.firstStepFrom) / $(2_000)) * 0.01,
    );
  it.each([
    [0, 0.35],
    [15_000, 0.35],
    [15_001, 0.34],
    [17_000, 0.34],
    [17_001, 0.33],
    [30_000, 0.27],
    [41_000, 0.22],
    [41_001, 0.21],
    [43_000, 0.21],
    [43_001, 0.2],
    [500_000, 0.2],
  ])("an income of $%d gets %d", (agi, expected) => {
    expect(Math.round(share(agi) * 100)).toBe(Math.round(expected * 100));
  });
  it("lets the same share through for a joint return: there is no second ladder in 2025", () => {
    expect(c.bottomShare).toBe(c.middleShare);
    expect(c.costLimit).toEqual([$(3_000), $(6_000)]);
  });
});
