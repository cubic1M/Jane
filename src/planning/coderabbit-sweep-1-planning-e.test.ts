import { describe, expect, it } from "vitest";
import { obbbaDeduction } from "./obbba-deductions";
import { yearInterest } from "./lender-interest";
import { levers, longView, type LongViewInput } from "./long-view";
import { lotsFor, realised, type InvHolding, type InvTransaction } from "./investment-taxes";

// CodeRabbit sweep, part 1 (money figures), src/planning chunk 5: each case is a finding
// reproduced against the code first (failing), then fixed.

describe("tips, overtime and car-loan interest over the income line", () => {
  const tips = (claimedCents: number, magiCents: number) =>
    obbbaDeduction("tips", { claimedCents, magiCents, status: "single", taxYear: 2026 }).cents;
  it("cuts the smaller of the claim and the most, so $1,000 at $160,000 is nothing", () => {
    // $10,000 over the $150,000 line is ten steps of $100.
    expect(tips(100_000, 16_000_000)).toBe(0);
    expect(tips(100_000, 15_500_000)).toBe(50_000);
  });
  it("still caps a big claim, and cuts it from the cap", () => {
    expect(tips(5_000_000, 14_000_000)).toBe(2_500_000);
    expect(tips(5_000_000, 15_500_000)).toBe(2_500_000 - 50_000);
  });
});

describe("a year's interest across several loans", () => {
  const loan = (over: object) => ({
    ytdInterestPaidCents: null as number | null,
    readOn: null as string | null,
    lastPaymentDate: null as string | null,
    balanceCents: null as number | null,
    aprBps: null as number | null,
    ...over,
  });
  it("paces each loan by its own last payment", () => {
    // $10 a monthly payment: $110 through November's 11th, $60 through June's 6th: $120 each.
    const a = loan({
      ytdInterestPaidCents: 11_000,
      readOn: "2026-11-15",
      lastPaymentDate: "2026-11-10",
    });
    const b = loan({
      ytdInterestPaidCents: 6_000,
      readOn: "2026-11-15",
      lastPaymentDate: "2026-06-10",
    });
    expect(yearInterest([a, b], 2026, "2026-11-20")?.cents).toBe(24_000);
  });
  it("adds a loan with no figure of its own at its balance times its rate", () => {
    const a = loan({ ytdInterestPaidCents: 86_007, readOn: "2026-11-20" });
    const b = loan({ balanceCents: 100_000, aprBps: 1_200 });
    const alone = yearInterest([a], 2026, "2026-11-20")!;
    const both = yearInterest([a, b], 2026, "2026-11-20")!;
    expect(both.cents).toBe(alone.cents + 12_000);
  });
});

describe("long view: an extra payment on a debt that is not a card", () => {
  const input: LongViewInput = {
    cashCents: 0,
    investedCents: 0,
    growingAssetsCents: 0,
    otherAssetsCents: 0,
    debts: [
      { name: "Loan", balanceCents: 120_000, aprBps: 0, paymentCents: 10_000, fromMargin: false },
    ],
    marginCents: 0,
    investMonthlyCents: 0,
  };
  const rates = { investedLow: 0, investedHigh: 0, cash: 0, home: 0 };
  it("is paid out of what's saved, so it can't free money it never had", () => {
    // $1,200 interest-free at $100 a month: paying $100 more clears it in 6 months at the cost of $100 a month,
    // and frees only its own $100 afterwards: no gain over the base case at zero growth.
    const lever = levers(input, rates, 10_000).find((l) => l.key === "debt:Loan")!;
    expect(lever.deltaCents).toBeLessThanOrEqual(0);
    expect(longView(input, rates)[0]).toBeDefined();
  });
});

describe("investment sales", () => {
  const holding = (o: Partial<InvHolding>): InvHolding => ({
    accountId: "brk",
    securityId: "pdifx",
    ticker: "PDIFX",
    name: "Fund",
    type: "mutual fund",
    quantity: 100,
    valueCents: 200_000,
    costBasisCents: 250_000,
    ...o,
  });
  const tx = (o: Partial<InvTransaction>): InvTransaction => ({
    accountId: "brk",
    securityId: "pdifx",
    date: "2026-09-24",
    type: "sell",
    subtype: "sell",
    quantity: -10,
    amountCents: -20_000,
    ...o,
  });
  it("leaves out a sale whose cost isn't known, rather than reading it as all gain", () => {
    const { sales } = lotsFor(100, [tx({ amountCents: -75_000 })]);
    expect(realised(holding({ costBasisCents: null }), sales, [])).toEqual([]);
    expect(realised(holding({}), sales, [])).toHaveLength(1);
  });
  it("lets one replacement purchase cover one loss sale once", () => {
    // Two 10-share loss sales and one 10-share purchase inside both windows.
    const sells = [
      tx({ date: "2026-09-24", quantity: -10, amountCents: -20_000 }),
      tx({ date: "2026-09-26", quantity: -10, amountCents: -20_000 }),
    ];
    const { sales } = lotsFor(100, sells);
    const buy = tx({
      type: "buy",
      subtype: "buy",
      date: "2026-09-28",
      quantity: 10,
      amountCents: 20_000,
    });
    const out = realised(holding({ costBasisCents: 500_000 }), sales, [buy]);
    // $20 loss on each ($500 a share average cost, $200 proceeds... per 10 shares): only one is replaced.
    const disallowed = out.map((r) => r.washDisallowedCents);
    expect(disallowed.filter((c) => c > 0)).toHaveLength(1);
  });
});
