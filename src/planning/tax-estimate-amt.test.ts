import { describe, expect, it } from "vitest";
import { federalParams } from "@/config/tax-params";
import { amt } from "@/planning/equity-tax";
import {
  estimateTaxes,
  marginalRateOf,
  NO_INCOME,
  type EstimateInput,
} from "@/planning/tax-estimate";

// Tax T4 part 3: three defects CodeRabbit found in the estimator before T4 (listed in #2354), each
// with its source and a hand example. Sources: Form 6251 (2025) lines 1b, 12 to 40 and the
// Publication 505 (2026) Tax Rate Schedules, read 2026-11-27.
const $ = (dollars: number) => Math.round(dollars * 100);

const person = (over: Partial<EstimateInput> = {}): EstimateInput => ({
  year: 2026,
  filingStatus: "single",
  childrenUnder17: 0,
  otherDependants: 0,
  state: null,
  income: { ...NO_INCOME, wagesCents: $(100_000), socialSecurityWagesCents: $(100_000) },
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

describe("the AMT keeps the 0/15/20% rates on long-term gains and qualified dividends (Form 6251 Part III)", () => {
  // HE-T4c (2026, single): wages $100,000, long-term gains $50,000, ISO preference $300,000.
  // AGI $150,000; standard $16,100; taxable $133,900, of which $50,000 is gains: regular ordinary
  // income $83,900. AMT income = 133,900 + 16,100 + 300,000 = 450,000, under the $500,000 phase-out
  // start, so the exemption is the full $90,100 and line 12 is $359,900.
  //   Part III: line 16 = 50,000 gains; line 17 = 309,900 at 26% to $244,500 and 28% above
  //   = 63,570 + 65,400 x 28% = 63,570 + 18,312 = 81,882 (line 18). The $49,450 zero-rate room is used
  //   up by the $83,900 of ordinary income (line 21 = 0), so the 50,000 is taxed at 15% (line 31 =
  //   7,500). Line 38 = 89,382. Line 39 (all at 26/28) = 63,570 + 115,400 x 28% = 95,882. Line 40
  //   = the smaller = 89,382.
  //   Regular tax: 13,170 on the 83,900 (1,240 + 12% x 38,000 + 22% x 33,500) + 15% x 50,000 = 20,670.
  //   AMT = 89,382 - 20,670 = 68,712 (the old code taxed all at 26/28: 95,882 - 20,670 = 75,212).
  it("HE-T4c: tentative minimum tax $89,382.00 and AMT $68,712.00 (was $75,212.00)", () => {
    const e = estimateTaxes(
      person({
        income: {
          ...NO_INCOME,
          wagesCents: $(100_000),
          socialSecurityWagesCents: $(100_000),
          longTermGainsCents: $(50_000),
        },
        amtPreferenceCents: $(300_000),
      }),
    );
    expect(e.taxableCents).toBe($(133_900));
    expect(e.incomeTaxCents).toBe($(20_670));
    expect(e.amtCents).toBe($(68_712));
  });

  const base = {
    status: "single" as const,
    addBackCents: 0,
    preferenceCents: 0,
    regularTaxCents: 0,
    year: 2026,
  };

  it("with no gains it is the 26/28% tax on the whole, as before", () => {
    expect(amt({ ...base, taxableCents: $(359_900) + $(90_100) }).tentativeCents).toBe($(95_882));
  });

  it("gains that fit in the zero-rate room are taxed at 0%", () => {
    // AMT income 240,100 less the 90,100 exemption: line 12 = 150,000; gains 40,000 on regular
    // ordinary income of 20,000: room at 0% = 49,450 - 20,000 = 29,450; at 15% = 10,550.
    // Ordinary part 110,000 x 26% = 28,600; 15% x 10,550 = 1,582.50 -> 30,182.50.
    const r = amt({
      ...base,
      taxableCents: $(240_100),
      preferentialCents: $(40_000),
      regularOrdinaryCents: $(20_000),
    });
    expect(r.tentativeCents).toBe($(30_182.5));
  });

  it("gains above the 20% edge are taxed at 20%", () => {
    // Regular ordinary income 540,000, gains 100,000: 5,500 of room under the $545,500 edge at 15%,
    // 94,500 at 20%. AMT income 800,000 is over $680,200, so the exemption is gone.
    const r = amt({
      ...base,
      taxableCents: $(800_000),
      preferentialCents: $(100_000),
      regularOrdinaryCents: $(540_000),
    });
    const ordinary = Math.round($(244_500) * 0.26 + ($(800_000) - $(100_000) - $(244_500)) * 0.28);
    expect(r.tentativeCents).toBe(ordinary + Math.round($(5_500) * 0.15 + $(94_500) * 0.2));
  });
});

describe("the AMT starts from taxable income before it is held at zero (Form 6251 line 1b)", () => {
  // HE-T4d (2026, single): wages $10,000, ISO preference $300,000. Taxable income before it is held
  // at zero = 10,000 - 16,100 = -6,100. AMT income = -6,100 + 16,100 + 300,000 = 310,000; exemption
  // 90,100; line 6 = 219,900; tax = 26% x 219,900 = 57,174. The regular tax is 0. (The old code
  // started from 0, added the whole $16,100 back and taxed 226,000: 58,760.)
  it("HE-T4d: AMT $57,174.00 (was $58,760.00)", () => {
    const e = estimateTaxes(
      person({
        income: { ...NO_INCOME, wagesCents: $(10_000), socialSecurityWagesCents: $(10_000) },
        amtPreferenceCents: $(300_000),
      }),
    );
    expect(e.taxableCents).toBe(0);
    expect(e.incomeTaxCents).toBe(0);
    expect(e.amtCents).toBe($(57_174));
  });
});

describe("the marginal rate at an exact bracket start is the new bracket's", () => {
  const single = federalParams(2026).brackets.value.single;
  // Publication 505 (2026) Rate Schedule X: "over $12,400 but not over $50,400: $1,240 + 12% of the
  // excess over $12,400", so the next dollar at exactly $12,400 is taxed at 12%.
  it("single 2026: 10% one cent under $12,400, 12% at $12,400, 22% at $50,400", () => {
    expect(marginalRateOf($(12_400) - 1, single)).toBe(0.1);
    expect(marginalRateOf($(12_400), single)).toBe(0.12);
    expect(marginalRateOf($(50_400), single)).toBe(0.22);
    expect(marginalRateOf(0, single)).toBe(0.1);
  });

  it("every bracket start gives that bracket's rate and the cent before it the one below", () => {
    single.forEach((b, i) => {
      expect(marginalRateOf(b.over, single), `at ${b.over}`).toBe(b.rate);
      if (i > 0)
        expect(marginalRateOf(b.over - 1, single), `under ${b.over}`).toBe(single[i - 1]!.rate);
    });
  });

  it("the estimate's marginalRate is 12% for taxable income of exactly $12,400", () => {
    const at = (wages: number) =>
      estimateTaxes(
        person({
          income: { ...NO_INCOME, wagesCents: wages, socialSecurityWagesCents: wages },
        }),
      );
    // $28,500 of wages less the $16,100 standard deduction = $12,400 taxable.
    expect(at($(28_500)).taxableCents).toBe($(12_400));
    expect(at($(28_500)).marginalRate).toBe(0.12);
    expect(at($(28_500) - 1).marginalRate).toBe(0.1);
  });
});

describe("gains below the standard deduction still reach the AMT's Part III (CodeRabbit on #2366)", () => {
  // HE-T4d (2026, single): long-term gains $10,000, no wages, ISO preference $300,000. Regular
  // taxable income is 10,000 - 16,100 = -6,100, held at $0 for the regular tax, but the AMT starts
  // from the unclamped figure (line 1b): -6,100 + 16,100 + 300,000 = $310,000; less the $90,100
  // exemption (under the $500,000 phase-out start) is $219,900. Part III: the $10,000 of gains
  // (line 13, not capped at the regular taxable income of $0) sit at 0% since regular ordinary
  // income is $0; the other $209,900 is taxed at 26% (under the $244,500 edge) = $54,574.00.
  // Regular tax is $0, so the AMT is $54,574.00. Capping the gains at $0 would have taxed all
  // $219,900 at 26%: $57,174.00.
  it("is $54,574.00, not $57,174.00", () => {
    const e = estimateTaxes(
      person({
        income: { ...NO_INCOME, longTermGainsCents: $(10_000) },
        amtPreferenceCents: $(300_000),
      }),
    );
    expect(e.taxableCents).toBe(0);
    expect(e.amtCents).toBe($(54_574));
  });
});
