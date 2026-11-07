import { describe, expect, it } from "vitest";
import { CONSOLIDATED, INT, NEC, W2_NEXT_LINE, W2_SAME_LINE } from "./__fixtures__/forms";
import { parseTaxForm } from "./parse";

// A box left blank on a W-2 or 1099 has no amount of its own. The reader took the first amount
// after the label on that line or the next, so a blank box read as the next box's amount: a W-2
// with nothing withheld said $64,000 withheld. Made-up forms, no real person or employer.

describe("a blank box on a W-2 or 1099", () => {
  it("is left out, not read as the Social Security wages on the next line", () => {
    const form = [
      "Form W-2 Wage and Tax Statement 2025",
      "1 Wages, tips, other compensation 61,240.00   2 Federal income tax withheld",
      "3 Social security wages 64,000.00   4 Social security tax withheld 3,968.00",
    ].join("\n");
    expect(parseTaxForm(form).boxes).toEqual({
      wages: 6_124_000,
      socialSecurityWages: 6_400_000,
      socialSecurityTax: 396_800,
    });
  });

  it("is left out, not read as the next box's amount on the same line", () => {
    const form = [
      "Form W-2 Wage and Tax Statement 2025",
      "1 Wages, tips, other compensation   2 Federal income tax withheld 6,120.50",
    ].join("\n");
    expect(parseTaxForm(form).boxes).toEqual({ federalWithheld: 612_050 });
  });

  it("on a 1099-NEC is left out, not read as the state tax under it", () => {
    const form = [
      "Form 1099-NEC 2025 Nonemployee Compensation",
      "1 Nonemployee compensation $12,500.00",
      "4 Federal income tax withheld",
      "5 State tax withheld $300.00",
    ].join("\n");
    expect(parseTaxForm(form).boxes).toEqual({ compensation: 1_250_000 });
  });

  it("on a 1099-INT is left out, not read as the early withdrawal penalty", () => {
    const form = [
      "Form 1099-INT 2025 Interest Income",
      "1 Interest income",
      "2 Early withdrawal penalty 25.00",
      "4 Federal income tax withheld 10.00",
    ].join("\n");
    expect(parseTaxForm(form).boxes).toEqual({ federalWithheld: 1_000 });
  });
});

describe("labels side by side over a row of amounts", () => {
  it("are left out, since which amount is whose can't be told", () => {
    const form = [
      "Form W-2 Wage and Tax Statement 2025",
      "1 Wages, tips, other compensation   2 Federal income tax withheld",
      "61,240.00   6,120.50",
      "3 Social security wages 64,000.00",
    ].join("\n");
    expect(parseTaxForm(form).boxes).toEqual({ socialSecurityWages: 6_400_000 });
  });
});

describe("a filled box", () => {
  it("is still read on its label's line or alone on the next", () => {
    expect(parseTaxForm(W2_SAME_LINE).boxes.federalWithheld).toBe(612_050);
    expect(parseTaxForm(W2_SAME_LINE).boxes.stateWages).toBe(6_124_000);
    expect(parseTaxForm(W2_NEXT_LINE).boxes).toEqual({
      wages: 4_800_000,
      federalWithheld: 420_000,
    });
    expect(parseTaxForm(NEC).boxes).toEqual({ compensation: 1_250_000, federalWithheld: 0 });
    expect(parseTaxForm(INT).boxes).toEqual({ interest: 84_327 });
    expect(parseTaxForm(CONSOLIDATED).boxes).toEqual({
      dividends: 120_411,
      qualifiedDividends: 98_040,
    });
  });
});
