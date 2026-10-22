import { describe, expect, it } from "vitest";
import { NO_INCOME, type EstimateInput } from "./tax-estimate";
import { estateFacts, giftsOverExclusion, mustBeEmptyBy, spreadIra, stepUp } from "./inheritance";

// Spec step 268: the 10-year rule's deadline and a spread that keeps brackets low, the step-up
// in basis, gifts over the exclusion, and the estate tax facts.

const $ = (d: number) => Math.round(d * 100);
const base = (wages: number): EstimateInput => ({
  year: 2026,
  filingStatus: "married_joint",
  childrenUnder17: 0,
  otherDependants: 0,
  state: null,
  income: { ...NO_INCOME, wagesCents: $(wages), socialSecurityWagesCents: $(wages) },
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

describe("the 10-year rule", () => {
  it("ends the 10th year after the death", () => {
    expect(mustBeEmptyBy(2025)).toBe(2035);
    expect(mustBeEmptyBy(2020)).toBe(2030);
  });

  it("spreads an IRA to pay less tax than taking it all in the last year", () => {
    const s = spreadIra({ balanceCents: $(200_000), yearsLeft: 10, base: base(150_000) });
    expect(s.perYearCents).toBe($(20_000));
    expect(s.spreadTaxCents).toBeLessThan(s.lumpTaxCents);
    expect(s.savesCents).toBe(s.lumpTaxCents - s.spreadTaxCents);
    expect(s.worthRaising).toBe(true);
  });

  it("saves less in a low bracket and nothing in the last year", () => {
    const low = spreadIra({ balanceCents: $(40_000), yearsLeft: 10, base: base(40_000) });
    const high = spreadIra({ balanceCents: $(200_000), yearsLeft: 10, base: base(150_000) });
    expect(low.savesCents).toBeLessThan(high.savesCents);
    const last = spreadIra({ balanceCents: $(200_000), yearsLeft: 1, base: base(150_000) });
    expect(last.savesCents).toBe(0);
    expect(last.worthRaising).toBe(false);
  });
});

describe("the step-up in basis", () => {
  it("measures the gain from the value at death, not what the owner paid", () => {
    const r = stepUp({
      valueAtDeathCents: $(300_000),
      costToOwnerCents: $(40_000),
      saleCents: $(310_000),
    });
    expect(r.gainWithStepUp).toBe($(10_000));
    expect(r.gainWithout).toBe($(270_000));
    expect(r.gainAvoided).toBe($(260_000));
    expect(
      stepUp({ valueAtDeathCents: $(300_000), costToOwnerCents: 0, saleCents: $(250_000) })
        .gainWithStepUp,
    ).toBe(0);
  });
});

describe("gifts", () => {
  const gifts = [
    { recipient: "EMILY", cents: $(25_000) },
    { recipient: "EMILY", cents: $(15_000) },
    { recipient: "DANIEL", cents: $(600) },
    { recipient: "SAM", cents: $(19_000) },
  ];

  it("flags a person given more than the exclusion in the year, and says if splitting covers it", () => {
    const joint = giftsOverExclusion(gifts, $(19_000), true);
    expect(joint).toEqual([
      { recipient: "EMILY", cents: $(40_000), overCents: $(21_000), splitCovers: false },
    ]);
    const smaller = giftsOverExclusion([{ recipient: "EMILY", cents: $(30_000) }], $(19_000), true);
    expect(smaller[0].splitCovers).toBe(true);
    expect(
      giftsOverExclusion([{ recipient: "EMILY", cents: $(30_000) }], $(19_000), false)[0]
        .splitCovers,
    ).toBe(false);
  });

  it("flags exactly the exclusion as fine", () => {
    expect(giftsOverExclusion([{ recipient: "SAM", cents: $(19_000) }], $(19_000), false)).toEqual(
      [],
    );
  });
});

describe("estate tax facts", () => {
  it("says most owe nothing, names the state's tax, and points to a lawyer", () => {
    const wa = estateFacts("WA");
    expect(wa[0]).toContain("15 million");
    expect(wa[1]).toContain("Washington");
    expect(wa[wa.length - 1]).toContain("estate lawyer");
    expect(estateFacts("TX")).toHaveLength(2);
  });
});
