import { describe, expect, it } from "vitest";
import { AMT, ESPP_RULES, ISO_RULES, RSU_WITHHOLDING } from "@/config/equity-tax";
import { NO_INCOME, estimateTaxes, type EstimateInput } from "./tax-estimate";
import { amt, esppSale, isoExercise, rsuVest, type Event } from "./equity-tax";

// Spec step 219: AMT and holding-period rules from config with sources; each case tested.

const base: Event = {
  kind: "espp",
  company: "Acme",
  shares: 100,
  occurredOn: "2025-03-01",
  grantedOn: "2024-09-01",
  priceCents: 8_500,
  fmvCents: 10_000,
  withheldCents: null,
  soldOn: null,
  soldPriceCents: null,
};
const sold = (over: Partial<Event>): Event => ({
  ...base,
  soldOn: "2026-06-01",
  soldPriceCents: 12_000,
  ...over,
});

describe("the rules in config", () => {
  it("carry their numbers", () => {
    expect(ESPP_RULES).toEqual({ yearsAfterGrant: 2, yearsAfterPurchase: 1 });
    expect(ISO_RULES).toEqual({ yearsAfterGrant: 2, yearsAfterExercise: 1 });
    expect(RSU_WITHHOLDING.flatRate).toBe(0.22);
    expect(AMT.exemption.single).toBe(9_010_000);
    expect(AMT.lowRate).toBe(0.26);
  });
});

describe("ESPP sales", () => {
  it("is disqualifying inside 2 years of the offering: the discount is ordinary income", () => {
    const r = esppSale(sold({}))!;
    // Offered Sep 2024, sold Jun 2026: under 2 years. Bought Mar 2025, sold over a year later.
    expect(r.qualifying).toBe(false);
    expect(r.ordinaryCents).toBe(150_000);
    expect(r.gainCents).toBe(200_000);
    expect(r.longTerm).toBe(true);
    // Without the offering price, what a qualifying sale would have saved isn't known.
    expect(r.lostTreatmentCents).toBe(0);
  });

  it("is qualifying after 2 years from the offering and 1 from the purchase", () => {
    const r = esppSale(sold({ soldOn: "2026-09-02" }))!;
    expect(r.qualifying).toBe(true);
    // The spread at purchase stands in for the offering discount: ordinary income is capped
    // at it, the rest of the gain is long-term.
    expect(r.ordinaryCents).toBe(150_000);
    expect(r.gainCents).toBe(200_000);
    expect(r.lostTreatmentCents).toBe(0);
    // Exactly 2 years isn't more than 2 years.
    expect(esppSale(sold({ soldOn: "2026-09-01" }))!.qualifying).toBe(false);
  });

  it("uses the offering discount when known: the rest of a qualifying sale's gain is long-term", () => {
    const q = esppSale(sold({ soldOn: "2026-10-01", grantDiscountCents: 1_000 }))!;
    expect(q).toMatchObject({ qualifying: true, ordinaryCents: 100_000, gainCents: 250_000 });
    const d = esppSale(sold({ grantDiscountCents: 1_000 }))!;
    expect(d.ordinaryCents).toBe(150_000);
    expect(d.lostTreatmentCents).toBe(50_000);
  });

  it("is a disqualifying sale inside a year of the purchase, short-term, and a loss still has ordinary income", () => {
    const r = esppSale(sold({ soldOn: "2025-08-01", soldPriceCents: 9_000 }))!;
    expect(r).toMatchObject({
      qualifying: false,
      ordinaryCents: 150_000,
      gainCents: -100_000,
      longTerm: false,
    });
  });

  it("is nothing until sold", () => {
    expect(esppSale(base)).toBeNull();
  });
});

describe("ISO exercises and the AMT preference", () => {
  const iso: Event = {
    ...base,
    kind: "iso",
    occurredOn: "2026-02-10",
    priceCents: 200,
    fmvCents: 1_200,
    shares: 5_000,
  };

  it("counts the spread as the preference when the shares are held past year-end", () => {
    expect(isoExercise(iso, 2026)).toEqual({
      preferenceCents: 5_000_000,
      ordinaryCents: 0,
      gainCents: 0,
    });
    expect(isoExercise(iso, 2025)).toBeNull();
  });

  it("makes a sale in the year of exercise ordinary income, with no preference", () => {
    expect(isoExercise({ ...iso, soldOn: "2026-11-01", soldPriceCents: 1_500 }, 2026)).toEqual({
      preferenceCents: 0,
      ordinaryCents: 5_000_000,
      gainCents: 1_500_000,
    });
  });
});

describe("the alternative minimum tax", () => {
  const single = {
    status: "single" as const,
    taxableCents: 12_000_000,
    addBackCents: 1_610_000,
    regularTaxCents: 2_000_000,
  };

  it("is nothing without a preference big enough to matter", () => {
    expect(amt({ ...single, preferenceCents: 0 }).amtCents).toBe(0);
  });

  it("is the tentative minimum tax over the regular tax", () => {
    const r = amt({ ...single, preferenceCents: 5_000_000 });
    // AMT income 12,000,000 + 1,610,000 + 5,000,000 = 18,610,000; exemption 9,010,000;
    // base 9,600,000 at 26%.
    expect(r.amtIncomeCents).toBe(18_610_000);
    expect(r.tentativeCents).toBe(Math.round(9_600_000 * 0.26));
    expect(r.amtCents).toBe(Math.round(9_600_000 * 0.26) - 2_000_000);
  });

  it("charges 28% above the threshold and phases the exemption out", () => {
    const r = amt({
      status: "single",
      taxableCents: 60_000_000,
      addBackCents: 0,
      preferenceCents: 0,
      regularTaxCents: 0,
    });
    // Over $500,000 of AMT income the exemption shrinks 50 cents a dollar (26 USC 55(d)(4)(A)(ii)(IV),
    // from 2026): $90,100 - $50,000 = $40,100. Base $559,900; tax $244,500 x 26% + $315,400 x 28%
    // = $63,570 + $88,312 = $151,882.
    expect(r.tentativeCents).toBe(15_188_200);
  });

  it("phases the exemption out completely at the IRS's published amounts (Rev. Proc. 2025-32 4.10)", () => {
    const tentative = (status: "single" | "married_joint" | "married_separate", amti: number) =>
      amt({
        status,
        taxableCents: amti,
        addBackCents: 0,
        preferenceCents: 0,
        regularTaxCents: 0,
      }).tentativeCents;
    // At the complete-phase-out amount the exemption is nil, so the tax is on all of the income.
    for (const [status, from, full] of [
      ["single", 500_000, 680_200],
      ["married_joint", 1_000_000, 1_280_400],
      ["married_separate", 500_000, 640_200],
    ] as const) {
      const high = AMT.highRateFrom[status];
      const all = (amti: number) =>
        Math.round(Math.min(amti, high) * 0.26 + Math.max(0, amti - high) * 0.28);
      expect(tentative(status, full * 100), status).toBe(all(full * 100));
      expect(tentative(status, from * 100), status).toBe(all(from * 100 - AMT.exemption[status]));
    }
  });

  it("is in the estimate: ISOs held past year-end raise the total tax", () => {
    const input: EstimateInput = {
      year: 2026,
      filingStatus: "single",
      childrenUnder17: 0,
      otherDependants: 0,
      state: null,
      income: { ...NO_INCOME, wagesCents: 14_000_000, socialSecurityWagesCents: 14_000_000 },
      studentLoanInterestCents: 0,
      mortgageInterestCents: 0,
      charityCents: 0,
      medicalCents: 0,
      otherStateLocalTaxCents: 0,
      federalWithheldCents: 0,
      federalEstimatedPaidCents: 0,
      stateWithheldCents: 0,
      stateEstimatedPaidCents: 0,
    };
    const without = estimateTaxes(input);
    const withIso = estimateTaxes({ ...input, amtPreferenceCents: 8_000_000 });
    expect(without.amtCents).toBe(0);
    expect(withIso.amtCents).toBeGreaterThan(0);
    expect(withIso.totalTaxCents).toBe(without.totalTaxCents + withIso.amtCents);
    // A small preference doesn't trigger it.
    expect(estimateTaxes({ ...input, amtPreferenceCents: 100_000 }).amtCents).toBe(0);
  });
});

describe("RSU withholding", () => {
  const rsu: Event = { ...base, kind: "rsu", shares: 500, priceCents: 0, fmvCents: 20_000 };

  it("is withheld at the flat 22% unless the person knows better, and falls short at a higher rate", () => {
    const r = rsuVest(rsu, 0.35)!;
    expect(r.incomeCents).toBe(10_000_000);
    expect(r.withheldCents).toBe(2_200_000);
    expect(r.shortfallCents).toBe(1_300_000);
    expect(rsuVest(rsu, 0.22)!.shortfallCents).toBe(0);
    expect(rsuVest(rsu, 0.12)!.shortfallCents).toBe(0);
  });

  it("uses what was actually withheld", () => {
    expect(rsuVest({ ...rsu, withheldCents: 3_000_000 }, 0.35)!.shortfallCents).toBe(500_000);
  });

  it("withholds 37% on the part of the year's supplemental wages over $1 million", () => {
    const r = rsuVest(rsu, 0.37, 95_000_000)!;
    // 100,000 + 95,000 supplemental ($950,000) puts $50,000 over a million... in cents:
    const over = Math.max(0, 95_000_000 + 10_000_000 - RSU_WITHHOLDING.highFromCents);
    expect(r.withheldCents).toBe(Math.round((10_000_000 - over) * 0.22 + over * 0.37));
  });
});
