import { describe, expect, it } from "vitest";
import { TAX_FORMS } from "@/config/tax";
import {
  COMPARED,
  DOCUMENT_BOXES,
  checkDocument,
  formAmount,
  usable,
  withinTolerance,
} from "./tax-document-check";

// Spec step 166: a collected form is checked against the accounts; one that disagrees is
// flagged and never used until the person says it's right.

describe("checking a tax form against the accounts", () => {
  it("compares a W-2's take-home pay: wages less everything withheld", () => {
    const w2 = {
      wages: 356_800,
      federalWithheld: 56_557,
      socialSecurityTax: 23_591,
      medicareTax: 5_517,
      stateWithheld: 21_000,
      otherWithheld: 5_135,
      retirement: 23_700,
    };
    expect(formAmount("w2", w2)).toBe(245_000);
    expect(checkDocument("w2", w2, 245_000)).toEqual({
      status: "matches",
      formCents: 245_000,
      seenCents: 245_000,
      diffCents: 0,
    });
  });

  it("compares each 1099's and 1098's own amount", () => {
    expect(formAmount("nec", { compensation: 500_000 })).toBe(500_000);
    expect(formAmount("int", { interest: 4_210 })).toBe(4_210);
    expect(formAmount("brokerage", { dividends: 12_000, proceeds: 900_000 })).toBe(12_000);
    expect(formAmount("r", { gross: 100_000, federalWithheld: 20_000 })).toBe(80_000);
    expect(formAmount("g", { amount: 300_000, federalWithheld: 30_000 })).toBe(270_000);
    expect(formAmount("mortgage", { interest: 1_023_040 })).toBe(1_023_040);
  });

  it("flags a form that disagrees, beyond $1 or 1%", () => {
    expect(withinTolerance(100_100, 100_000)).toBe(true);
    expect(withinTolerance(101_001, 100_000)).toBe(false);
    expect(withinTolerance(5_100, 5_000)).toBe(true);
    expect(withinTolerance(5_101, 5_000)).toBe(false);
    expect(checkDocument("nec", { compensation: 450_000 }, 500_000)).toEqual({
      status: "differs",
      formCents: 450_000,
      seenCents: 500_000,
      diffCents: -50_000,
    });
  });

  it("says when there's nothing to check against", () => {
    expect(checkDocument("mortgage", { interest: 900_000 }, null).status).toBe("unchecked");
  });

  it("never uses a flagged form unless the person says it's right", () => {
    const differs = checkDocument("int", { interest: 9_000 }, 4_000);
    expect(usable(differs, false)).toBe(false);
    expect(usable(differs, true)).toBe(true);
    expect(usable(checkDocument("int", { interest: 4_000 }, 4_000), false)).toBe(true);
    expect(usable(checkDocument("student", { interest: 4_000 }, null), false)).toBe(true);
  });

  it("knows the boxes and what's compared for every form", () => {
    for (const key of Object.keys(TAX_FORMS) as (keyof typeof TAX_FORMS)[]) {
      expect(Object.keys(DOCUMENT_BOXES[key]).length, key).toBeGreaterThan(0);
      expect(COMPARED[key], key).not.toBe("");
    }
  });
});
