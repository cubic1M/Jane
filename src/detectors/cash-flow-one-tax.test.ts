import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { DETECTORS } from "./index";

// CodeRabbit sweep 1c (det-05, 9): monthly payroll tax and quarterly sales tax paid from different
// accounts are two bills; the weekly set-aside is worked out from one of them, not their blend.
const cashFlow = DETECTORS.find((d) => d.topic === "cash_flow")!;
const CHECKING = "demo-seedowner-checking";
const SAVINGS = "demo-seedowner-savings";

const withTaxes = (
  taxes: readonly { date: string; cents: number; payee: string; accountId: string }[],
  keepDeposits = true,
) => {
  const d = inputFor("owner");
  const data = {
    ...d,
    transactions: [
      ...d.transactions.filter(
        (t) =>
          !/\b(?:SALES|PAYROLL|USE|EXCISE) TAX\b/i.test(t.description) &&
          (keepDeposits || t.amountCents >= 0),
      ),
      ...taxes.map((t) => ({
        ...d.transactions[0],
        date: t.date,
        amountCents: t.cents,
        description: t.payee,
        pfc: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
        accountId: t.accountId,
      })),
    ],
  };
  return cashFlow.detect({ profile: buildProfile(data), data });
};

const sales = (dates: readonly string[]) =>
  dates.map((date) => ({
    date,
    cents: 400_000,
    payee: "STATE DEPT OF REVENUE SALES TAX",
    accountId: CHECKING,
  }));
const payroll = (dates: readonly string[]) =>
  dates.map((date) => ({
    date,
    cents: 100_000,
    payee: "EFTPS PAYROLL TAX",
    accountId: SAVINGS,
  }));

describe("the business tax bill the weekly set-aside is for", () => {
  const monthly = ["2025-11-10", "2025-12-10", "2026-01-10", "2026-02-10", "2026-03-10"];
  const quarterly = ["2025-10-20", "2026-01-20"];

  it("is the one tax's rhythm, not a blend of monthly payroll tax and quarterly sales tax", () => {
    const s = withTaxes([...sales(quarterly), ...payroll(monthly)]);
    // Sales tax is the larger total ($8,000 against $5,000), every 3 months.
    expect(s?.short).toMatch(/every 3 months/);
    expect(s?.short).toContain("$4,000.00");
    expect(s?.why).toContain("sales tax");
  });

  it("says the payroll tax is every month when that is the larger bill", () => {
    const s = withTaxes([
      ...sales(quarterly),
      ...payroll(monthly).map((p) => ({ ...p, cents: 900_000 })),
    ]);
    expect(s?.short).toMatch(/every month/);
    expect(s?.why).toContain("payroll tax");
  });

  it("does not say the sales arrive in that account when no deposit goes into it", () => {
    const s = withTaxes(payroll(monthly));
    expect(s?.why).toContain("payroll tax");
    expect(s?.why).not.toMatch(/same account/);
    expect(withTaxes(sales(quarterly))?.why).toMatch(/same account/);
  });
});
