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
  demoOrderTransactions,
  demoSecurities,
} from "./demo-holdings";

// Spec step 128: the demo bank's holdings, shaped like Plaid Investments.

const DEMO = { seed: "abc123", anchor: "2026-10-18" };
// The anchor's eve: prices are the demo bank's own (spec step 156 moves them after).
const TODAY = "2026-10-17";

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
    const securities = new Set(demoSecurities(TODAY, DEMO.anchor).map((s) => s.security_id));
    for (const h of demoHoldings(DEMO, TODAY)) {
      expect(securities.has(h.security_id), h.security_id).toBe(true);
      expect(h.iso_currency_code).toBe("USD");
      expect(h.cost_basis).not.toBeNull();
      const n = normalizeHolding(h);
      expect(n?.valueCents).toBe(Math.round(h.institution_value * 100));
    }
    expect(demoSecurities(TODAY, DEMO.anchor).map((s) => normalizeSecurity(s).ticker)).toContain(
      "NSTDX",
    );
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

describe("simulated orders on the demo bank (spec step 133)", () => {
  const brokerage = "demo-abc123-brokerage";
  const orders = [
    {
      id: "o1",
      accountRef: brokerage,
      ticker: "PDIFX",
      side: "sell" as const,
      quantity: 100,
      amountCents: 217_200,
      day: "2026-10-18",
    },
    {
      id: "o2",
      accountRef: brokerage,
      ticker: "KTBIX",
      side: "buy" as const,
      quantity: 200,
      amountCents: 196_800,
      day: "2026-10-18",
    },
  ];
  const before = demoHoldings(DEMO, TODAY);
  const after = demoHoldings(DEMO, TODAY, orders);
  const total = (holdings: typeof before) =>
    holdings
      .filter((h) => h.account_id === brokerage)
      .reduce((s, h) => s + Math.round(h.institution_value * 100), 0);
  const of = (holdings: typeof before, id: string) =>
    holdings.find((h) => h.account_id === brokerage && h.security_id === id);

  it("keeps the account's total: cash takes the difference", () => {
    expect(total(after)).toBe(total(before));
    expect(Math.round(of(after, "demo-sec-cash")!.institution_value * 100)).toBe(
      Math.round(of(before, "demo-sec-cash")!.institution_value * 100) + 217_200 - 196_800,
    );
  });

  it("sells shares with their share of the cost basis, and buys new ones at cost", () => {
    const pdifx = of(after, "demo-sec-pdifx")!;
    expect(pdifx.quantity).toBeCloseTo(42.317, 6);
    expect(pdifx.cost_basis).toBeCloseTo((3_640 * 42.317) / 142.317, 2);
    expect(of(after, "demo-sec-ktbix")).toMatchObject({ quantity: 200, cost_basis: 1_968 });
  });

  it("drops a holding sold in full, and lists the orders as investment transactions", () => {
    const all = demoHoldings(DEMO, TODAY, [
      {
        id: "o3",
        accountRef: brokerage,
        ticker: "KLCX",
        side: "sell",
        quantity: 7.5,
        amountCents: 339_225,
        day: "2026-10-18",
      },
    ]);
    expect(of(all, "demo-sec-klcx")).toBeUndefined();
    const rows = demoOrderTransactions(DEMO, orders, "2026-10-17", "2026-10-18");
    expect(rows.map((r) => [r.investment_transaction_id, r.type, r.amount])).toEqual([
      ["demo-abc123-order-o1", "sell", -2_172],
      ["demo-abc123-order-o2", "buy", 1_968],
    ]);
  });
});

describe("deposits on the demo bank (spec step 134)", () => {
  it("add to the account's cash, and show as a deposit", () => {
    const brokerage = "demo-abc123-brokerage";
    const deposit = {
      id: "d1",
      accountRef: brokerage,
      ticker: "CASH",
      side: "deposit" as const,
      quantity: 100,
      amountCents: 10_000,
      day: "2026-10-18",
    };
    const cash = (h: ReturnType<typeof demoHoldings>) =>
      Math.round(
        h.find((x) => x.account_id === brokerage && x.security_id === "demo-sec-cash")!
          .institution_value * 100,
      );
    expect(cash(demoHoldings(DEMO, TODAY, [deposit]))).toBe(
      cash(demoHoldings(DEMO, TODAY)) + 10_000,
    );
    expect(demoOrderTransactions(DEMO, [deposit], "2026-10-17", "2026-10-18")[0]).toMatchObject({
      type: "cash",
      subtype: "deposit",
      amount: -100,
      security_id: null,
    });
  });
});

describe("the demo HSA (spec step 159)", () => {
  it("is there only when linked, and holds its balance", () => {
    expect(demoAccounts(DEMO).some((a) => a.subtype === "hsa")).toBe(false);
    const hsa = demoAccounts(DEMO, ["hsa"]).find((a) => a.subtype === "hsa")!;
    const held = demoHoldings(DEMO, TODAY, [], ["hsa"]).filter(
      (h) => h.account_id === hsa.account_id,
    );
    expect(held.reduce((s, h) => s + Math.round(h.institution_value * 100), 0)).toBe(427_180);
    expect(demoHoldings(DEMO, TODAY).some((h) => h.account_id === hsa.account_id)).toBe(false);
  });

  it("is paid into every payday", () => {
    const year = demoInvestmentTransactions(DEMO, "2025-10-17", "2026-10-17", ["hsa"]);
    const hsa = year.filter((t) => t.name === "HSA PAYROLL CONTRIBUTION");
    expect(hsa).toHaveLength(24);
    expect(hsa.reduce((s, t) => s - t.amount, 0)).toBe(2_400);
  });
});

describe("the demo stock plan (spec step 160)", () => {
  it("is there only when linked, and holds 150 Acme shares", () => {
    expect(demoAccounts(DEMO).some((a) => a.subtype === "stock plan")).toBe(false);
    const plan = demoAccounts(DEMO, ["stock_plan"]).find((a) => a.subtype === "stock plan")!;
    const held = demoHoldings(DEMO, TODAY, [], ["stock_plan"]).filter(
      (h) => h.account_id === plan.account_id,
    );
    expect(held.reduce((s, h) => s + Math.round(h.institution_value * 100), 0)).toBe(2_046_000);
    const acme = held.find((h) => h.quantity === 150)!;
    expect(acme.cost_basis).toBe(14_700);
  });

  it("vested in four lots behind its cost basis", () => {
    const vests = demoInvestmentTransactions(DEMO, "2025-01-01", TODAY, ["stock_plan"]).filter(
      (t) => t.name === "RSU VEST ACME CORP",
    );
    expect(vests.map((t) => t.quantity)).toEqual([37.5, 37.5, 37.5, 37.5]);
    expect(vests.reduce((s, t) => s + t.amount, 0)).toBe(14_700);
  });
});
