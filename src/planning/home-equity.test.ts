import { describe, expect, it } from "vitest";
import {
  addMonths,
  cheapest,
  compareProject,
  escrowCheck,
  escrowLetter,
  monthlyPayment,
  mortgagePi,
  pmiOriginalLetter,
  pmiTimeline,
} from "./home-equity";

// Spec step 228: PMI against the original value, escrow against the real bills, and the
// ways to borrow for a project.

describe("monthlyPayment", () => {
  it("pays a $400,000 loan at 3.99% over 30 years", () => {
    expect(monthlyPayment(40_000_000, 399, 360)).toBeCloseTo(190_730, -2);
    expect(monthlyPayment(0, 399, 360)).toBe(0);
    expect(monthlyPayment(120_000, 0, 12)).toBe(10_000);
  });
});

describe("pmiTimeline", () => {
  const pi = mortgagePi({ originationPrincipalCents: 40_000_000, aprBps: 399, termYears: 30 });
  it("is askable at 80% of the original value and ends at 78%, with dates", () => {
    const t = pmiTimeline({
      originalValueCents: 50_000_000,
      balanceCents: 39_000_000,
      aprBps: 399,
      paymentPiCents: pi,
      today: "2026-10-18",
    });
    expect(t.askBalanceCents).toBe(40_000_000);
    expect(t.autoBalanceCents).toBe(39_000_000);
    expect(t.canAskNow).toBe(true);
    expect(t.endsNow).toBe(true);
    expect(t.monthsToAsk).toBe(0);
    const later = pmiTimeline({
      originalValueCents: 50_000_000,
      balanceCents: 42_000_000,
      aprBps: 399,
      paymentPiCents: pi,
      today: "2026-10-18",
    });
    expect(later.canAskNow).toBe(false);
    expect(later.monthsToAsk!).toBeGreaterThan(0);
    expect(later.monthsToAuto!).toBeGreaterThan(later.monthsToAsk!);
    expect(later.askOn! > "2026-10-18").toBe(true);
    expect(later.autoOn! > later.askOn!).toBe(true);
  });
  it("can't date it without the payment", () => {
    const t = pmiTimeline({
      originalValueCents: 50_000_000,
      balanceCents: 42_000_000,
      aprBps: null,
      paymentPiCents: null,
      today: "2026-10-18",
    });
    expect(t.askOn).toBeNull();
  });
  it("drafts the request with the conditions", () => {
    const letter = pmiOriginalLetter({
      name: "Sam",
      loanName: "Mortgage",
      balanceCents: 39_900_000,
      originalValueCents: 50_000_000,
    });
    expect(letter).toContain("79.8% of the home's original value of $500,000.00");
    expect(letter).toContain("I am current on my payments");
    expect(letter).toContain("Sam");
  });
  it("adds months to a date, keeping to the month's end", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("escrowCheck", () => {
  const base = { paymentCents: 250_000, paymentPiCents: 190_000 };
  it("needs the bills and the split of the payment", () => {
    expect(
      escrowCheck({
        ...base,
        yearlyTaxCents: null,
        yearlyInsuranceCents: null,
        escrowBalanceCents: 1,
      }),
    ).toEqual({ kind: "unknown", why: "no_bills" });
    expect(
      escrowCheck({
        paymentCents: null,
        paymentPiCents: null,
        yearlyTaxCents: 1,
        yearlyInsuranceCents: 1,
        escrowBalanceCents: 1,
      }),
    ).toEqual({ kind: "unknown", why: "no_split" });
  });
  it("finds a surplus above a year of bills and the two-month cushion", () => {
    const c = escrowCheck({
      ...base,
      yearlyTaxCents: 400_000,
      yearlyInsuranceCents: 100_000,
      escrowBalanceCents: 700_000,
    });
    // 500,000 of bills, a cushion of two months (83,333), balance 700,000.
    expect(c).toMatchObject({ kind: "over", cushionCents: 83_333, surplusCents: 116_667 });
    // $600 a month collected is $7,200 a year against $5,000 of bills.
    expect(c.kind === "over" && c.gapYearlyCents).toBe(220_000);
  });
  it("calls it right when collecting about the bills", () => {
    const c = escrowCheck({
      ...base,
      paymentCents: 240_000,
      yearlyTaxCents: 400_000,
      yearlyInsuranceCents: 200_000,
      escrowBalanceCents: 300_000,
    });
    expect(c.kind).toBe("ok");
  });
  it("warns when the bills are bigger than what's collected", () => {
    const c = escrowCheck({
      ...base,
      yearlyTaxCents: 600_000,
      yearlyInsuranceCents: 300_000,
      escrowBalanceCents: 100_000,
    });
    expect(c.kind).toBe("short");
  });
  it("drafts the refund request with the figures", () => {
    const c = escrowCheck({
      ...base,
      yearlyTaxCents: 400_000,
      yearlyInsuranceCents: 100_000,
      escrowBalanceCents: 700_000,
    });
    if (!("billsCents" in c)) throw new Error("expected figures");
    const letter = escrowLetter({
      name: "",
      loanName: "Mortgage",
      check: c,
      yearlyTaxCents: 400_000,
      yearlyInsuranceCents: 100_000,
    });
    expect(letter).toContain("$5,000.00 a year ($4,000.00 tax and $1,000.00 insurance)");
    expect(letter).toContain("refund the surplus");
    expect(letter).toContain("[Your name]");
  });
});

describe("compareProject", () => {
  const input = {
    projectCents: 4_000_000,
    years: 10,
    homeValueCents: 60_000_000,
    mortgageBalanceCents: 30_000_000,
    mortgageAprBps: 399,
    mortgagePiCents: 150_000,
  };
  it("shows each option's all-in cost and picks the cheapest", () => {
    const o = compareProject(input);
    expect(o.map((x) => x.product)).toEqual(["heloc", "cash_out", "personal"]);
    const heloc = o[0];
    expect(heloc.totalCostCents).toBe(heloc.monthlyCents * 120 - 4_000_000 + 50_000);
    expect(o[2].upfrontCents).toBe(200_000);
    // A cash-out refinance at 6.5% over a 3.99% mortgage costs the extra interest.
    expect(o[1].totalCostCents).toBeGreaterThan(o[0].totalCostCents);
    expect(cheapest(o)!.product).toBe("heloc");
  });
  it("rules out what the home can't back, and what can't be compared", () => {
    const high = compareProject({ ...input, mortgageBalanceCents: 49_000_000 });
    expect(high[0].available).toBe(false);
    expect(high[0].why).toContain("85%");
    expect(high[1].available).toBe(false);
    expect(cheapest(high)!.product).toBe("personal");
    const unknown = compareProject({ ...input, mortgageAprBps: null, mortgagePiCents: null });
    expect(unknown[1].available).toBe(false);
  });
});
