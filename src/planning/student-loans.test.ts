import { describe, expect, it } from "vitest";
import { POVERTY_GUIDELINE_CENTS, PSLF_PAYMENTS, RAP } from "@/config/student-loans";
import { levelPaymentCents } from "./refinance";
import {
  compareStudentPlans,
  ibrPaymentCents,
  povertyGuidelineCents,
  rapPaymentCents,
  rapShare,
  standardPaymentCents,
  type StudentInput,
} from "./student-loans";

const input = (over: Partial<StudentInput> = {}): StudentInput => ({
  balanceCents: 1_834_500,
  aprBps: 525,
  currentPaymentCents: 19_500,
  agiCents: 5_000_000,
  familySize: 1,
  dependants: 0,
  borrower: "new",
  publicService: false,
  paymentsCounted: 0,
  ...over,
});

describe("the plans' payments, from their rules", () => {
  it("uses the poverty guideline for the family size", () => {
    expect(povertyGuidelineCents(1)).toBe(POVERTY_GUIDELINE_CENTS.first);
    expect(povertyGuidelineCents(3)).toBe(1_596_000 + 2 * 568_000);
  });

  it("Standard: the 10-year level payment, at least $50", () => {
    expect(standardPaymentCents(1_834_500, 525)).toBe(levelPaymentCents(1_834_500, 525, 120));
    expect(standardPaymentCents(100_000, 0)).toBe(5_000);
  });

  it("IBR: 10% of income above 150% of the guideline, never above Standard", () => {
    // $50,000 − 1.5 × $15,960 = $26,060; 10% is $2,606 a year, $217.17 a month.
    const big = { balanceCents: 5_000_000 };
    expect(ibrPaymentCents(input(big))).toBe(21_717);
    expect(ibrPaymentCents(input({ ...big, borrower: "old" }))).toBe(
      Math.round((0.15 * 2_606_000) / 12),
    );
    expect(ibrPaymentCents(input({ agiCents: 2_000_000 }))).toBe(0);
    expect(ibrPaymentCents(input({ agiCents: 50_000_000 }))).toBe(
      standardPaymentCents(1_834_500, 525),
    );
  });

  it("RAP: the income band's share a month, less $50 a dependant, at least $10", () => {
    expect(rapShare(5_000_000)).toBe(0.04);
    expect(rapShare(5_000_001)).toBe(0.05);
    expect(rapShare(20_000_000)).toBe(0.1);
    expect(rapPaymentCents(input())).toBe(Math.round((0.04 * 5_000_000) / 12));
    expect(rapPaymentCents(input({ dependants: 2 }))).toBe(
      Math.round((0.04 * 5_000_000) / 12) - 10_000,
    );
    expect(rapPaymentCents(input({ agiCents: 900_000 }))).toBe(RAP.minPaymentCents);
  });
});

describe("plans over time", () => {
  it("pays Standard off in 10 years, nothing forgiven", () => {
    const standard = compareStudentPlans(input(), { advice: false }).results.find(
      (r) => r.plan === "standard",
    )!;
    expect(standard.months).toBeLessThanOrEqual(120);
    expect(standard.forgivenCents).toBe(0);
  });

  it("forgives what's left on IBR after 20 years when the payment is low", () => {
    const ibr = compareStudentPlans(input({ agiCents: 2_500_000 }), { advice: false }).results.find(
      (r) => r.plan === "ibr",
    )!;
    expect(ibr.months).toBe(240);
    expect(ibr.forgivenCents).toBeGreaterThan(0);
  });

  it("on RAP, waives unpaid interest so the balance always goes down", () => {
    const rap = compareStudentPlans(input({ agiCents: 900_000 }), { advice: false }).results.find(
      (r) => r.plan === "rap",
    )!;
    // $10 a month never covers the interest, but principal falls $50 a month: after 30
    // years, what's left is the balance less 360 × $50, and that's forgiven.
    expect(rap.months).toBe(RAP.forgivenAfterYears * 12);
    expect(rap.forgivenCents).toBe(1_834_500 - 360 * RAP.minPrincipalDropCents);
  });

  it("forgives through PSLF after 120 qualifying payments, counting the ones made", () => {
    const pslf = compareStudentPlans(
      input({ publicService: true, paymentsCounted: 100, agiCents: 3_000_000 }),
      { advice: false },
    ).results.find((r) => r.plan === "ibr")!;
    expect(pslf.months).toBe(PSLF_PAYMENTS - 100);
    expect(pslf.viaPslf).toBe(true);
  });
});

describe("Jane's pick (demo advice only)", () => {
  it("picks nothing outside demo advice mode", () => {
    expect(compareStudentPlans(input(), { advice: false }).pick).toBeNull();
  });

  it("picks the least paid in all, and in public service the lowest payment", () => {
    const { results, pick } = compareStudentPlans(input(), { advice: true });
    const cheapest = [...results.filter((r) => r.plan !== "current")].sort(
      (a, b) => a.totalPaidCents - b.totalPaidCents,
    )[0];
    expect(pick?.plan).toBe(cheapest.plan);
    const ps = compareStudentPlans(input({ publicService: true }), { advice: true });
    const lowest = [...ps.results.filter((r) => r.plan !== "current")].sort(
      (a, b) => a.monthlyNowCents - b.monthlyNowCents,
    )[0];
    expect(ps.pick?.plan).toBe(lowest.plan);
    expect(ps.pick?.why[0]).toMatch(/^In public service, the lowest payment wins/);
  });
});
