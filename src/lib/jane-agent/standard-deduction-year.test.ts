import { describe, expect, it } from "vitest";
import { NoTaxParamsError } from "@/config/tax-params";
import type { TaxEstimateView } from "@/lib/tax-estimate";
import { standardDeductionReply } from "./tax-replies";

// Tax T32c: the chat's standard deduction answer names the amounts of the year asked (Rev. Proc.
// 2025-32 section 4.14: $16,100 for 2026; Rev. Proc. 2026-35 section 3.15: $16,600 single, $33,200
// joint, $24,925 head of household for 2027), never another year's.
const view = (year: number) =>
  ({
    year,
    estimate: {
      filingStatus: "single",
      deduction: { kind: "standard", standardCents: 0, itemizedCents: 0 },
    },
  }) as unknown as TaxEstimateView;

describe("the standard deduction answer", () => {
  it("quotes the year's own amounts", () => {
    expect(standardDeductionReply(view(2026)).body).toContain(
      "The 2026 standard deduction is $16,100.00",
    );
    const body = standardDeductionReply(view(2027)).body;
    expect(body).toContain(
      "The 2027 standard deduction is $16,600.00 for single filers, $33,200.00",
    );
    expect(body).toContain("$24,925.00 head of household");
  });
  it("has no amounts for a year without IRS figures", () => {
    expect(() => standardDeductionReply(view(2028))).toThrow(NoTaxParamsError);
  });
});
