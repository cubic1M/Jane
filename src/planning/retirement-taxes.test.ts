import { describe, expect, it } from "vitest";
import { IRMAA } from "@/config/retirement-taxes";
import { inputFor } from "@/profile/sample";
import { buildProfile } from "@/profile/build";
import { readRetirementTaxes } from "./retirement-taxes-read";
import { irmaaFor, irmaaYear, socialSecurityTax, tunedDraw } from "./retirement-taxes";

// Spec step 271: how much Social Security is taxable, Medicare's surcharge two years ahead, and
// the order to draw tuned to stay under it. Thresholds by year from config.

const $ = (d: number) => Math.round(d * 100);

describe("Social Security's taxable part", () => {
  it("is nothing under the first line", () => {
    expect(
      socialSecurityTax({
        benefitsCents: $(24_000),
        otherIncomeCents: $(10_000),
        status: "single",
      }),
    ).toMatchObject({ provisionalCents: $(22_000), taxableCents: 0, extraTaxablePerDollar: 0 });
  });

  it("is up to half between the lines, and up to 85% past the second", () => {
    // Provisional $30,000: half of the $5,000 over $25,000.
    expect(
      socialSecurityTax({ benefitsCents: $(20_000), otherIncomeCents: $(20_000), status: "single" })
        .taxableCents,
    ).toBe($(2_500));
    // Ruth: $32,160 of benefits, $28,080 of pension and IRA: provisional $44,160.
    const ruth = socialSecurityTax({
      benefitsCents: $(32_160),
      otherIncomeCents: $(28_080),
      status: "single",
    });
    expect(ruth.provisionalCents).toBe($(44_160));
    expect(ruth.taxableCents).toBe($(4_500) + $(8_636));
    expect(ruth.extraTaxablePerDollar).toBe(0.85);
  });

  it("never taxes more than 85% of the benefit, and uses the couple's lines when married", () => {
    const rich = socialSecurityTax({
      benefitsCents: $(40_000),
      otherIncomeCents: $(200_000),
      status: "single",
    });
    expect(rich.taxableCents).toBe($(34_000));
    expect(rich.extraTaxablePerDollar).toBe(0);
    expect(
      socialSecurityTax({
        benefitsCents: $(40_000),
        otherIncomeCents: $(10_000),
        status: "married_joint",
      }).taxableCents,
    ).toBe(0);
  });
});

describe("Medicare's surcharge", () => {
  it("uses the published table for its year, and grows the latest for a later one", () => {
    expect(irmaaYear(2026)).toMatchObject({ estimated: false, single: IRMAA[2026].single });
    const later = irmaaYear(2028);
    expect(later.estimated).toBe(true);
    expect(later.single[0]).toBe($(115_000));
    expect(later.joint[0]).toBe($(229_000));
  });

  it("is set by income two years before: tier, room to the next line, what crossing it costs", () => {
    const i = irmaaFor({ magiCents: $(120_000), status: "single", incomeYear: 2024, people: 1 });
    expect(i).toMatchObject({
      premiumYear: 2026,
      estimated: false,
      tier: 1,
      monthlyPerPersonCents: $(81.2) + $(14.5),
      nextLineCents: $(137_000),
      roomCents: $(17_000),
    });
    expect(i.nextYearlyCents).toBe(($(202.9) + $(37.5) - $(81.2) - $(14.5)) * 12);
    const couple = irmaaFor({
      magiCents: $(150_000),
      status: "married_joint",
      incomeYear: 2024,
      people: 2,
    });
    expect(couple).toMatchObject({ tier: 0, nextLineCents: $(218_000), roomCents: $(68_000) });
    expect(couple.nextYearlyCents).toBe(($(81.2) + $(14.5)) * 12 * 2);
  });
});

describe("the order to draw, tuned to stay under the line", () => {
  const base = {
    otherIncomeCents: $(90_000),
    ssBenefitsCents: 0,
    status: "single" as const,
    incomeYear: 2024,
    people: 1,
    taxableGainShare: 0.3,
  };

  it("takes taxable money first, then pre-tax as far as the line allows, then Roth", () => {
    const t = tunedDraw({
      ...base,
      needCents: $(40_000),
      balances: { preTaxCents: $(500_000), taxableCents: $(100_000), rothCents: $(100_000) },
    });
    // Income of 2024 sets 2026's premiums: the single line is $109,000, $19,000 away.
    // All $40,000 from taxable accounts adds $12,000 of gains; $6,999 of room is left for pre-tax.
    expect(t.taxableCents).toBe($(40_000));
    expect(t.preTaxCents).toBe(0);
    expect(t.preTaxCapCents).toBe($(19_000) - 100 - $(12_000));
    expect(t.rothCents).toBe(0);
    expect(t.magiCents).toBeLessThan($(109_000));
  });

  it("counts Social Security's taxable part growing with each pre-tax dollar", () => {
    const t = tunedDraw({
      ...base,
      otherIncomeCents: $(70_000),
      ssBenefitsCents: $(30_000),
      needCents: $(40_000),
      balances: { preTaxCents: $(500_000), taxableCents: 0, rothCents: $(100_000) },
    });
    expect(t.magiCents).toBeLessThan($(109_000));
    expect(t.preTaxCapCents!).toBeLessThan($(39_000));
    expect(t.rothCents).toBe($(40_000) - t.preTaxCents);
  });

  it("goes over the line only when nothing else is left", () => {
    const t = tunedDraw({
      ...base,
      needCents: $(40_000),
      balances: { preTaxCents: $(500_000), taxableCents: 0, rothCents: 0 },
    });
    expect(t.preTaxCents).toBe($(40_000));
    expect(t.roomCents!).toBeLessThan(0);
  });
});

describe("the sample people get their own figures", () => {
  const read = (id: "preretire" | "retiree") => {
    const d = inputFor(id);
    return readRetirementTaxes(buildProfile(d), d);
  };

  it("the retiree: Social Security partly taxed, her next IRA dollar at about 22%", () => {
    const ruth = read("retiree");
    expect(ruth).toMatchObject({ status: "single", people: 1, ssBenefitsCents: $(32_160) });
    expect(ruth.ss.taxableCents).toBe($(13_136));
    expect(ruth.bracket).toBe(0.12);
    expect(ruth.nextDollarRate).toBeCloseTo(0.222, 3);
    expect(ruth.irmaa).toMatchObject({ premiumYear: 2028, tier: 0, nextLineCents: $(115_000) });
  });

  // Night QA 10-30: three months of a retiree's statements read as a year: $2,412 of Social
  // Security a month came out as "$7,236 a year", $603 a month.
  it("makes a year of benefits from a few months of statements", () => {
    const year = inputFor("retiree");
    const cut = new Date(Date.parse(`${year.today}T00:00:00Z`) - 85 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const recent = { ...year, transactions: year.transactions.filter((t) => t.date >= cut) };
    const short = readRetirementTaxes(buildProfile(recent), recent);
    expect(short.ssDeposits).toBeGreaterThan(0);
    expect(short.ssDeposits).toBeLessThan(4);
    expect(short.ssBenefitsCents).toBe(read("retiree").ssBenefitsCents);
  });

  it("the couple near retirement: no Social Security yet, the couple's line two years ahead", () => {
    const dan = read("preretire");
    expect(dan).toMatchObject({ status: "married_joint", people: 2, ssBenefitsCents: 0 });
    expect(dan.irmaa).toMatchObject({ premiumYear: 2028, tier: 0, nextLineCents: $(229_000) });
    expect(dan.irmaa.roomCents).toBe($(229_000) - dan.magiCents);
    expect(dan.tuned.preTaxCapCents).toBeGreaterThan(0);
  });
});
