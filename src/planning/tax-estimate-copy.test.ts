import { describe, expect, it } from "vitest";
import type { TaxEstimate } from "./tax-estimate";
import { federalLine, taxPaidText } from "./tax-estimate-copy";

// Night QA 10-30: "Your employer has withheld about $0 … At this pace it will be about $9,500
// by the end" for a person whose $9,500 was an estimated payment and whose withholding Jane
// can't see.
describe("taxPaidText", () => {
  const base = {
    withheldSoFarCents: 0,
    withheldProjectedCents: 0,
    estimatedPaidCents: 950_000,
    totalTaxCents: 3_999_900,
  };

  it("doesn't claim $0 withheld when withholding isn't visible, and names estimated tax", () => {
    const { text } = taxPaidText({ ...base, withholdingKnown: false });
    expect(text).not.toMatch(/withheld about \$0/);
    expect(text).toMatch(/not what's withheld/);
    expect(text).toMatch(/You've paid \$9,500 in estimated tax this year\./);
    expect(text).toMatch(/about \$39,999\.$/);
  });

  it("says withholding and its pace when the pay stub shows it", () => {
    const { text, figures } = taxPaidText({
      withholdingKnown: true,
      withheldSoFarCents: 1_800_000,
      withheldProjectedCents: 2_200_000,
      estimatedPaidCents: 0,
      totalTaxCents: 2_400_000,
    });
    expect(text).toBe(
      "Your employer has withheld about $18,000 of federal tax from your pay so far this year, about $22,000 by the end at this pace. That's against $24,000 of tax.",
    );
    expect(figures).toContain(2_200_000);
  });
});

// Debugger 11-04: someone who'd paid the IRS $36,000 in estimated tax read only "I need your pay
// stub figures": what Jane can see wasn't said.
describe("the federal line when what was withheld isn't known", () => {
  const estimate = { totalTaxCents: 3_049_837, year: 2026, refundCents: 0 } as TaxEstimate;

  it("says what estimated payments it can see", () => {
    expect(federalLine(estimate, false, 3_600_000)).toBe(
      "Federal: about $30,498 of tax for 2026. You've paid $36,000 in estimated tax this year. I need your pay stub figures to say whether that's a refund or a bill.",
    );
  });

  it("says nothing of them when there are none, or when the full picture is known", () => {
    expect(federalLine(estimate, false, 0)).not.toContain("estimated tax");
    expect(federalLine(estimate, true, 3_600_000)).not.toContain("estimated tax");
  });
});
