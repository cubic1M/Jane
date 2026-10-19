import { describe, expect, it } from "vitest";
import {
  formatBps,
  investmentSummary,
  isRetirement,
  monthlyInvestments,
  subtypeLabel,
  type HoldingRow,
  type InvestmentAccountRow,
  type SecurityRow,
} from "./investments";
import { netWorth } from "./net-worth";

// Spec step 128: what the person owns, from their holdings.

const ACCOUNTS: InvestmentAccountRow[] = [
  { id: "k", name: "Work 401(k)", subtype: "401k", balanceCents: 100_000, institution: "Bank A" },
  { id: "b", name: "Brokerage", subtype: "brokerage", balanceCents: 50_000, institution: null },
];
const SECURITIES: SecurityRow[] = [
  {
    id: "s1",
    name: "Northstar Target 2055 Fund",
    ticker: "NSTDX",
    type: "mutual fund",
    isCashEquivalent: false,
  },
  { id: "s2", name: "Some Corp", ticker: "SOME", type: "equity", isCashEquivalent: false },
  { id: "s3", name: "Cash", ticker: null, type: "cash", isCashEquivalent: true },
];
const holding = (over: Partial<HoldingRow>): HoldingRow => ({
  id: "h",
  accountId: "k",
  securityId: "s1",
  quantity: 1,
  priceCents: 100,
  priceAsOf: "2026-10-16",
  valueCents: 0,
  costBasisCents: null,
  ...over,
});
const HOLDINGS: HoldingRow[] = [
  holding({ id: "h1", valueCents: 100_000, costBasisCents: 80_000 }),
  holding({
    id: "h2",
    accountId: "b",
    securityId: "s2",
    valueCents: 30_000,
    costBasisCents: 40_000,
  }),
  holding({
    id: "h3",
    accountId: "b",
    securityId: "s3",
    valueCents: 20_000,
    costBasisCents: 20_000,
  }),
];

describe("investmentSummary", () => {
  const summary = investmentSummary(ACCOUNTS, SECURITIES, HOLDINGS);

  it("totals the balances exactly as net worth does", () => {
    const worth = netWorth(ACCOUNTS.map((a) => ({ ...a, type: "investment" })));
    expect(summary.totalCents).toBe(worth.investmentsCents);
    expect(summary.byKind).toEqual({ retirement: 100_000, investment: 50_000 });
    expect(summary.holdingCount).toBe(3);
  });

  it("shows every holding with its source, cost, gain and the fund's yearly cost", () => {
    const [k, b] = summary.accounts;
    expect(k.label).toBe("401(k)");
    expect(k.holdingsMatch).toBe(true);
    expect(k.holdings[0]).toMatchObject({
      name: "Northstar Target 2055 Fund",
      gainCents: 20_000,
      expenseRatioBps: 75,
      category: "Target date 2055",
      source: "Bank A, Work 401(k), price as of Oct 16, 2026",
    });
    expect(k.holdings[0].factsSource).toMatch(/sample data/);
    const some = b.holdings.find((h) => h.name === "Some Corp")!;
    expect(some).toMatchObject({
      gainCents: -10_000,
      expenseRatioBps: null,
      mix: { us_stocks: 1 },
    });
    expect(some.source).toBe("Your bank, Brokerage, price as of Oct 16, 2026");
    expect(b.holdings.find((h) => h.isCash)?.gainCents).toBeNull();
    for (const h of summary.accounts.flatMap((a) => a.holdings)) expect(h.source).toBeTruthy();
  });

  it("splits funds into asset classes by what they hold", () => {
    const by = Object.fromEntries(summary.byAssetClass.map((c) => [c.assetClass, c.valueCents]));
    expect(by).toEqual({ us_stocks: 84_000, intl_stocks: 36_000, bonds: 10_000, cash: 20_000 });
  });

  it("says when the holdings don't add up to the balance", () => {
    const off = investmentSummary(ACCOUNTS, SECURITIES, HOLDINGS.slice(0, 2));
    expect(off.accounts.find((a) => a.id === "b")).toMatchObject({
      holdingsCents: 30_000,
      holdingsMatch: false,
    });
    const none = investmentSummary(ACCOUNTS, SECURITIES, []);
    expect(none.accounts.every((a) => !a.holdingsMatch && a.holdings.length === 0)).toBe(true);
    expect(none.totalCents).toBe(150_000);
  });
});

describe("monthlyInvestments", () => {
  it("takes each account's last snapshot in or before each month, by kind", () => {
    const months = monthlyInvestments(
      ACCOUNTS,
      [
        { accountId: "k", date: "2026-08-10", balanceCents: 90_000 },
        { accountId: "k", date: "2026-09-30", balanceCents: 95_000 },
        { accountId: "b", date: "2026-09-02", balanceCents: 40_000 },
        { accountId: "other", date: "2026-09-02", balanceCents: 1 },
      ],
      "2026-10-19",
      4,
    );
    expect(months).toEqual([
      { month: "2026-07", retirementCents: 0, investmentCents: 0, totalCents: null },
      { month: "2026-08", retirementCents: 90_000, investmentCents: 0, totalCents: 90_000 },
      { month: "2026-09", retirementCents: 95_000, investmentCents: 40_000, totalCents: 135_000 },
      { month: "2026-10", retirementCents: 95_000, investmentCents: 40_000, totalCents: 135_000 },
    ]);
  });
});

describe("labels", () => {
  it("names account types and yearly costs plainly", () => {
    expect(subtypeLabel("roth")).toBe("Roth IRA");
    expect(subtypeLabel(null)).toBe("Investment account");
    expect(isRetirement("retirement")).toBe(true);
    expect(isRetirement("brokerage")).toBe(false);
    expect(formatBps(75)).toBe("0.75%");
    expect(formatBps(3)).toBe("0.03%");
  });
});
