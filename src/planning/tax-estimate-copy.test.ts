import { describe, expect, it } from "vitest";
import { taxPaidText } from "./tax-estimate-copy";

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
