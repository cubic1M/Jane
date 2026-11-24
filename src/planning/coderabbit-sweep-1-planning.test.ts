import { describe, expect, it } from "vitest";
import { CASH_MIN_MOVE_CENTS } from "@/config/cash";
import type { CardProduct } from "@/lib/credit-cards/partner";
import type { ReportItem } from "@/lib/credit/partner";
import type { InsightTransaction } from "@/insights/spending";
import { cashPlan } from "./cash";
import { compareOptions, type CompareOption } from "./compare";
import { diversifyPlan } from "./company-stock";
import { summarize, type Tx } from "./costly-borrowing";
import { contractYear } from "./costly-products";
import { REWARD_CATEGORIES } from "@/config/credit-cards";
import { feeCheck, yearSpend, type Spend } from "./credit-cards";
import { nextStatementClose } from "./credit-building";
import { fixItems } from "./credit-report-fixes";
import { cryptoReplay } from "./crypto-strategies";
import { unrealised } from "./crypto-tax";

// CodeRabbit sweep, part 1 (money figures), src/planning chunk 2: each case is a finding
// reproduced against the code first (failing), then fixed.

describe("compare: a one-time fee comes off a savings option's first year", () => {
  const option = (oneTimeFeeCents: number): CompareOption => ({
    id: "s1",
    kind: "savings",
    category: "savings",
    merchantKey: null,
    provider: "Fern",
    name: "Fern Saver",
    monthlyCents: null,
    apyBps: 500,
    contractMonths: 0,
    oneTimeFeeCents,
    minimumBalanceCents: 0,
    includes: null,
    givesUp: null,
    signUpUrl: null,
    sourceUrl: "https://example.com",
    checkedAt: "2026-11-01",
    demo: true,
  });
  const cash = { kind: "savings", amountCents: 1_000_000, currentRateBps: 0 } as const;

  it("does not pick an option whose fee eats its first year", () => {
    // $10,000 at 5% earns $500; a $1,000 fee makes the first year negative.
    expect(compareOptions(cash, [option(100_000)])).toBeNull();
  });
  it("leaves a zero-fee option alone", () => {
    expect(compareOptions(cash, [option(0)])?.pick.firstYearCents).toBe(50_000);
  });
});

describe("cash plan: sweep cash moves only what the buckets leave", () => {
  const spending = 200_000;
  const sweep = (balanceCents: number) => ({
    id: "sw",
    name: "Brokerage sweep",
    kind: "sweep" as const,
    balanceCents,
    rateBps: 10,
  });

  it("makes no money market move when the buffer and emergency fund take it all", () => {
    // $10,000 swept, one month ($2,000) buffer, $8,000 emergency target: nothing left over.
    const plan = cashPlan({
      places: [sweep(1_000_000)],
      monthlySpendingCents: spending,
      emergencyTargetCents: 800_000,
    });
    expect(plan.buckets.find((b) => b.key === "longer_term")?.cents).toBe(0);
    expect(plan.moves.filter((m) => m.key === "sweep_to_money_market")).toEqual([]);
  });

  it("moves only the part beyond the buffer and the emergency fund", () => {
    const plan = cashPlan({
      places: [sweep(1_500_000)],
      monthlySpendingCents: spending,
      emergencyTargetCents: 800_000,
    });
    const moves = plan.moves.filter((m) => m.key === "sweep_to_money_market");
    expect(moves.map((m) => m.cents)).toEqual([500_000]);
    expect(moves[0]!.cents).toBeGreaterThanOrEqual(CASH_MIN_MOVE_CENTS);
  });
});

describe("crypto: unrealised gain by holding period", () => {
  it("takes each group's own basis: a $100 long coin and a $300 short coin worth $600", () => {
    const left = [
      { date: "2020-01-01", quantity: 1, costCents: 10_000 },
      { date: "2026-10-01", quantity: 1, costCents: 30_000 },
    ];
    const u = unrealised(60_000, left, "2026-11-24");
    // Value split by coins: $300 each. Long: 300 - 100 = 200. Short: 300 - 300 = 0.
    expect(u.longTermCents).toBe(20_000);
    expect(u.shortTermCents).toBe(0);
    expect(u.gainCents).toBe(20_000);
  });
});

describe("crypto strategies: a start date past the history", () => {
  const dates = Array.from({ length: 400 }, (_, i) =>
    new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
  );
  const closes = {
    BTC: dates.map((_, i) => 100 + i),
    ETH: dates.map((_, i) => 50 + i),
  };
  it("has nothing to replay when no date reaches it", () => {
    expect(cryptoReplay({ dates, closes }, "crypto_hold", 0, "2999-01-01", null)).toBeNull();
  });
  it("still replays from a date inside the history", () => {
    expect(cryptoReplay({ dates, closes }, "crypto_hold", 0, "2025-09-01", null)).not.toBeNull();
  });
});

describe("costly borrowing: a fee a loan didn't take in still counts", () => {
  const tx = (id: string, date: string, amountCents: number, description: string): Tx => ({
    id,
    date,
    amountCents,
    description,
    pfcDetailed: null,
    card: false,
  });
  it("counts another app's tip beside a paired advance", () => {
    const costly = summarize(
      [
        tx("a", "2026-05-01", -10_000, "EARNIN ADVANCE"),
        tx("b", "2026-05-15", 10_000, "EARNIN REPAYMENT"),
        tx("c", "2026-05-20", 300, "DAVE TIP"),
      ],
      "2026-06-01",
    );
    const apps = costly.kinds.find((k) => k.kind === "pay_app")!;
    expect(apps.costCents).toBe(300);
    expect(apps.count).toBe(2);
  });
  it("does not count a fee twice that a loan took in", () => {
    const costly = summarize(
      [
        tx("a", "2026-05-01", -10_000, "EARNIN ADVANCE"),
        tx("b", "2026-05-15", 10_000, "EARNIN REPAYMENT"),
        tx("c", "2026-05-15", 300, "EARNIN TIP"),
      ],
      "2026-06-01",
    );
    const apps = costly.kinds.find((k) => k.kind === "pay_app")!;
    expect(apps.costCents).toBe(300);
    expect(apps.count).toBe(1);
  });
});

describe("dates", () => {
  it("contract year turns over on the purchase anniversary, not at 365.25 days", () => {
    expect(contractYear("2025-01-01", "2025-12-31")).toBe(1);
    expect(contractYear("2025-01-01", "2026-01-01")).toBe(2);
    expect(contractYear("2024-02-29", "2025-02-28")).toBe(1);
    expect(contractYear("2024-02-29", "2025-03-01")).toBe(2);
  });

  it("the next statement close is after today even when the last one is years old", () => {
    expect(nextStatementClose("2023-01-15", "2026-11-24")).toBe("2026-12-15");
    expect(nextStatementClose("2026-10-15", "2026-11-24")).toBe(
      "2026-11-15" > "2026-11-24" ? "2026-11-15" : "2026-12-15",
    );
  });

  it("company stock's later parts clamp to the end of a short month", () => {
    const plan = diversifyPlan({
      quantity: 200,
      priceCents: 10_000,
      costBasisCents: 1_000_000,
      lots: [{ date: null, quantity: 200 }],
      totalInvestedCents: 10_000_000,
      today: "2026-01-31",
      rates: { longTerm: 0.15, shortTerm: 0.22 },
    });
    // January 31 plus three months is April 30, not May 1.
    expect(plan.parts.map((p) => p.on).slice(0, 2)).toEqual(["2026-01-31", "2026-04-30"]);
    expect(plan.parts.length).toBeGreaterThan(1);
  });
});

describe("credit cards", () => {
  const tx = (
    date: string,
    amountCents: number,
    primary: string,
    detailed: string,
  ): InsightTransaction => ({
    date,
    amountCents,
    description: "x",
    merchantName: null,
    pfcPrimary: primary,
    pfcDetailed: detailed,
    pending: false,
  });
  it("measures the history before leaving out what isn't spending", () => {
    // Pay 200 days back, one $100 dinner today: the history is 200 days, not one.
    const spend = yearSpend(
      [
        tx("2026-05-08", -300_000, "INCOME", "INCOME_WAGES"),
        tx("2026-11-24", 10_000, "FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT"),
      ],
      "2026-11-24",
    );
    expect(spend.days).toBeGreaterThanOrEqual(200);
    expect(spend.totalCents).toBeLessThan(100_000);
  });

  it("a card that earns nothing and has a fee does not pay for itself when there is no other card", () => {
    const card: CardProduct = {
      id: "c1",
      issuer: "Fern",
      name: "Fern Fee",
      annualFeeCents: 9_500,
      rateBps: {},
      baseRateBps: 0,
      rewardsLabel: "none",
      intro: null,
      minBand: "fair",
      sourceUrl: "https://example.com",
      demo: true,
    } as CardProduct;
    const none = Object.fromEntries(REWARD_CATEGORIES.map((c) => [c, 0])) as Spend;
    const check = feeCheck(card, none, []);
    expect(check?.netCents).toBe(-9_500);
    expect(check?.paysForItself).toBe(false);
  });
});

describe("credit report letters", () => {
  const item = (amountCents: number | null): ReportItem => ({
    id: "i1",
    kind: "collection",
    creditor: "Acme Collections",
    originalCreditor: "City Hospital",
    amountCents,
    firstSeenOn: "2026-10-01",
    detail: "collection",
    medical: true,
  });
  const dispute = (amountCents: number | null) =>
    fixItems(item(amountCents), "Pat").find((f) => f.kind === "dispute")!.body;

  it("does not say a medical collection is under the floor when the amount isn't known", () => {
    expect(dispute(null)).not.toMatch(/under \$/);
    expect(dispute(null)).toMatch(/investigated/);
  });
  it("still says it for a known small amount", () => {
    expect(dispute(10_000)).toMatch(/under \$/);
  });
});
