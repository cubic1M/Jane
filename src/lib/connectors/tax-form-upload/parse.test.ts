import { describe, expect, it } from "vitest";
import { CONSOLIDATED, INT, NEC, W2_NEXT_LINE, W2_SAME_LINE } from "./__fixtures__/forms";
import { parseTaxForm } from "./parse";

// Connectors roadmap round 16: the person's own W-2s and 1099s, read in memory, box amounts only.

describe("parseTaxForm", () => {
  it("reads a W-2's boxes when two sit on one line", () => {
    expect(parseTaxForm(W2_SAME_LINE)).toEqual({
      kind: "w2",
      boxes: {
        wages: 6_124_000,
        federalWithheld: 612_050,
        socialSecurityWages: 6_400_000,
        socialSecurityTax: 396_800,
        medicareWages: 6_400_000,
        medicareTax: 92_800,
        stateWages: 6_124_000,
        stateWithheld: 245_010,
      },
    });
  });

  it("reads an amount on the line after its label, and leaves out a box it can't find", () => {
    expect(parseTaxForm(W2_NEXT_LINE)).toEqual({
      kind: "w2",
      boxes: { wages: 4_800_000, federalWithheld: 420_000 },
    });
  });

  it("reads a 1099-NEC, a 1099-INT and a consolidated 1099's dividends past the first page", () => {
    expect(parseTaxForm(NEC)).toEqual({
      kind: "nec",
      boxes: { compensation: 1_250_000, federalWithheld: 0 },
    });
    expect(parseTaxForm(INT)).toEqual({ kind: "int", boxes: { interest: 84_327 } });
    expect(CONSOLIDATED.indexOf("Total Ordinary Dividends")).toBeGreaterThan(2_000);
    expect(parseTaxForm(CONSOLIDATED)).toEqual({
      kind: "brokerage",
      boxes: { dividends: 120_411, qualifiedDividends: 98_040 },
    });
  });

  it("keeps no name, SSN, EIN, address or account number", () => {
    for (const form of [W2_SAME_LINE, W2_NEXT_LINE, NEC, INT, CONSOLIDATED]) {
      const kept = JSON.stringify(parseTaxForm(form));
      for (const secret of ["SAMPLE", "6789", "3456789", "MAIN ST", "4417", "00012345", "5555"]) {
        expect(kept, secret).not.toContain(secret);
      }
    }
  });

  it("refuses what isn't a form it reads", () => {
    expect(() => parseTaxForm("Bank statement 1 Interest 12.00")).toThrow(/no form name/);
    expect(() => parseTaxForm("Form W-2 with nothing filled in")).toThrow(/no boxes/);
    expect(() => parseTaxForm(`Form W-2 ${"x".repeat(2_000_001)}`)).toThrow(/too large/);
  });
});
