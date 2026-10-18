import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { expectedCents, isRefundFor } from "./refund-check";

const approved = new Date("2026-10-18T15:00:00Z");
const credit = (over: Partial<Parameters<typeof isRefundFor>[1]> = {}) => ({
  id: "t1",
  date: new Date("2026-10-20T00:00:00Z"),
  amountCents: -6_420,
  description: "TARGET 00012345 REFUND",
  merchantName: null,
  accountId: "card",
  pfcPrimary: "GENERAL_MERCHANDISE",
  ...over,
});
const refund = { type: "request_refund", createdAt: approved, evidence: { merchant: "Target" } };
const fees = {
  type: "recover_bank_fees",
  createdAt: approved,
  evidence: { accountId: "checking" },
};

describe("refunds seen in transactions", () => {
  it("matches money coming back from the same company, on or after approval", () => {
    expect(isRefundFor(refund, credit())).toBe(true);
    expect(isRefundFor(refund, credit({ merchantName: "Target" }))).toBe(true);
    expect(isRefundFor(refund, credit({ description: "TARGETED ADS CREDIT" }))).toBe(false);
    expect(isRefundFor(refund, credit({ amountCents: 6_420 }))).toBe(false);
    expect(isRefundFor(refund, credit({ date: new Date("2026-10-17T00:00:00Z") }))).toBe(false);
    // The same day as the approval counts.
    expect(isRefundFor(refund, credit({ date: new Date("2026-10-18T00:00:00Z") }))).toBe(true);
  });

  it("matches a fee reversal on the same account", () => {
    const reversal = credit({
      accountId: "checking",
      description: "OVERDRAFT FEE REFUND",
      pfcPrimary: "OTHER",
      amountCents: -3_400,
    });
    expect(isRefundFor(fees, reversal)).toBe(true);
    expect(isRefundFor(fees, { ...reversal, accountId: "card" })).toBe(false);
    expect(isRefundFor(fees, credit({ accountId: "checking", pfcPrimary: "BANK_FEES" }))).toBe(
      true,
    );
    expect(isRefundFor(fees, credit({ accountId: "checking", description: "PAYROLL" }))).toBe(
      false,
    );
  });

  it("expects the card's amount, or for fees the total charged", () => {
    expect(expectedCents({ annualSavingsCents: 6_420 }, {})).toBe(6_420);
    expect(expectedCents({ annualSavingsCents: null }, { totalCents: 23_400 })).toBe(23_400);
    expect(expectedCents(null, null)).toBeNull();
  });
});
