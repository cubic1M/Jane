import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// CodeRabbit sweep 1c (PR #2268): the tax year runs Feb 1 to Jan 31 (src/lib/tax-estimate.ts), and
// a January estimated payment belongs to the year before (src/lib/tax-payments/direct-pay-steps.ts).
// A late fourth installment of 2025 paid on Jan 20, 2026 must not fill 2026's April installment.
const topics = (date: string) => {
  const d = inputFor("freelancer");
  const account = d.accounts[0]!.id;
  const data = {
    ...d,
    transactions: [
      ...d.transactions.filter((t) => t.pfc !== "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT"),
      {
        date,
        amountCents: 50_000_000,
        description: "IRS USATAXPYMT",
        pfc: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
        accountId: account,
      },
    ],
  };
  return runDetectors({ profile: buildProfile(data), data }).map((s) => s.topic);
};

describe("a January tax payment and the tax year", () => {
  it("does not count a payment from late January against this year's installments", () => {
    expect(topics("2026-01-20")).toContain("estimated_taxes");
    expect(topics("2026-01-31")).toContain("estimated_taxes");
  });
  it("counts a payment from the first day of the tax year", () => {
    expect(topics("2026-02-01")).not.toContain("estimated_taxes");
    expect(topics("2026-03-10")).not.toContain("estimated_taxes");
  });
});
