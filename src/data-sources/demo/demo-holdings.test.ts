import { describe, expect, it } from "vitest";
import { normalizeHolding, normalizeSecurity } from "@/data-sources/plaid/investments";
import { demoAccounts } from "./demo-bank";
import {
  DEMO_EMPLOYEE_RATE,
  DEMO_MATCH_RATE,
  DEMO_MATCH_UP_TO,
  DEMO_PAYCHECK_GROSS,
  demoHoldings,
  demoInvestmentTransactions,
  demoSecurities,
} from "./demo-holdings";

// Spec step 128: the demo bank's holdings, shaped like Plaid Investments.

const DEMO = { seed: "abc123", anchor: "2026-10-18" };
const TODAY = "2026-10-18";

describe("the demo bank's holdings", () => {
  it("add up to each investment account's balance to the cent", () => {
    const holdings = demoHoldings(DEMO, TODAY);
    for (const account of demoAccounts(DEMO).filter((a) => a.type === "investment")) {
      const total = holdings
        .filter((h) => h.account_id === account.account_id)
        .reduce((sum, h) => sum + Math.round(h.institution_value * 100), 0);
      expect(total, account.name).toBe(Math.round((account.balances.current ?? 0) * 100));
    }
  });

  it("are Plaid-shaped: every holding's security is listed, in dollars, with a cost basis", () => {
    const securities = new Set(demoSecurities(TODAY).map((s) => s.security_id));
    for (const h of demoHoldings(DEMO, TODAY)) {
      expect(securities.has(h.security_id), h.security_id).toBe(true);
      expect(h.iso_currency_code).toBe("USD");
      expect(h.cost_basis).not.toBeNull();
      const n = normalizeHolding(h);
      expect(n?.valueCents).toBe(Math.round(h.institution_value * 100));
    }
    expect(demoSecurities(TODAY).map((s) => normalizeSecurity(s).ticker)).toContain("NSTDX");
  });

  it("have something for each later step: a costly fund, the employer's shares, a gain and a loss", () => {
    const holdings = demoHoldings(DEMO, TODAY);
    const by = (id: string) => holdings.find((h) => h.security_id === id)!;
    expect(by("demo-sec-acme").institution_value).toBeGreaterThan(by("demo-sec-acme").cost_basis!);
    expect(by("demo-sec-pdifx").institution_value).toBeLessThan(by("demo-sec-pdifx").cost_basis!);
  });

  it("never change between syncs", () => {
    expect(demoHoldings(DEMO, TODAY)).toEqual(demoHoldings(DEMO, TODAY));
  });
});

describe("the demo bank's investment transactions", () => {
  const year = demoInvestmentTransactions(DEMO, "2025-10-17", "2026-10-17");

  it("are in the range asked for, oldest first, with ids unique to the item", () => {
    expect(year.every((t) => t.date > "2025-10-17" && t.date <= "2026-10-17")).toBe(true);
    expect(year.map((t) => t.date)).toEqual([...year.map((t) => t.date)].sort());
    expect(new Set(year.map((t) => t.investment_transaction_id)).size).toBe(year.length);
    expect(year[0].investment_transaction_id).toMatch(/^demo-abc123-inv-/);
  });

  it("pay into the 401(k) every payday, below the full match", () => {
    const contributions = year.filter((t) => t.subtype === "contribution");
    expect(contributions).toHaveLength(48);
    const employee = contributions.find((t) => t.name === "EMPLOYEE CONTRIBUTION")!;
    expect(employee.amount).toBe(-DEMO_PAYCHECK_GROSS * DEMO_EMPLOYEE_RATE);
    const match = contributions.find((t) => t.name === "EMPLOYER MATCH")!;
    expect(match.amount).toBe(employee.amount * DEMO_MATCH_RATE);
    expect(DEMO_EMPLOYEE_RATE).toBeLessThan(DEMO_MATCH_UP_TO);
  });

  it("include fees, a sale at a loss and a reinvested dividend within 30 days of it", () => {
    expect(year.filter((t) => t.subtype === "management fee")).toHaveLength(4);
    expect(year.filter((t) => t.subtype === "account fee")).toHaveLength(4);
    const sale = year.find((t) => t.name === "SELL PINNACLE DIVIDEND INCOME FUND")!;
    expect(sale.date).toBe("2026-09-24");
    expect(sale.amount).toBeLessThan(0);
    const after = year.filter(
      (t) =>
        t.security_id === sale.security_id &&
        t.type === "buy" &&
        t.date > sale.date &&
        t.date <= "2026-10-24",
    );
    expect(after.length).toBeGreaterThan(0);
  });
});
