import { describe, expect, it } from "vitest";
import { REFI_CARD_TERM_MONTHS, REFI_MIN_SAVING_CENTS } from "@/config/debt";
import { DEMO_LENDERS } from "@/data-sources/demo/demo-lenders";
import type { Debt } from "@/insights/debts";
import { demoQuote } from "@/lib/lenders/demo";
import type { LoanOffer } from "@/lib/lenders/partner";
import { payoffPlan } from "./debt";
import {
  compareRefinance,
  levelPaymentCents,
  refinanceable,
  remainingMonths,
  totalPaidCents,
} from "./refinance";

const AS_OF = "2026-10-19";
const debt = (over: Partial<Debt> & Pick<Debt, "key" | "kind">): Debt => ({
  accountId: null,
  name: over.key,
  kindLabel: over.kind,
  balanceCents: 1_802_000,
  balanceFrom: "bank",
  aprBps: 690,
  rateType: "fixed",
  aprFrom: "bank",
  paymentCents: 49_410,
  paymentEvery: "month",
  paymentFrom: "bank",
  nextDue: null,
  dueSoon: false,
  payoffDate: "2029-10-01",
  payoffFrom: "bank",
  overdue: false,
  pastDueCents: null,
  description: null,
  inNetWorth: true,
  typedOn: null,
  ...over,
});
const offer = (over: Partial<LoanOffer>): LoanOffer => ({
  id: "o",
  lender: "Lender",
  product: "auto",
  aprBps: 549,
  rateType: "fixed",
  termMonths: 36,
  feeCents: 0,
  feeLabel: "No fees",
  sourceUrl: "https://example.com",
  demo: true,
  ...over,
});
const CAR = debt({ key: "car", kind: "auto" });

describe("loan math", () => {
  it("pays a loan off with a level payment, like a lender's", () => {
    // $10,000 at 6% over 36 months is $304.22 a month.
    expect(levelPaymentCents(1_000_000, 600, 36)).toBe(30_422);
    expect(levelPaymentCents(1_200, 0, 4)).toBe(300);
  });

  it("adds up what's paid with the debt planner's own month-by-month interest", () => {
    const payment = levelPaymentCents(1_000_000, 600, 36);
    const plan = payoffPlan(
      [{ id: "x", name: "x", balanceCents: 1_000_000, aprBps: 600, minimumCents: payment }],
      payment,
      "avalanche",
    );
    expect(plan.ok && plan.months).toBe(36);
    expect(totalPaidCents(1_000_000, 600, 36)).toBe(plan.ok ? plan.totalPaidCents : -1);
  });
});

describe("what can be refinanced, over which months", () => {
  it("counts the months to the payoff date, and gives a card a fixed term", () => {
    expect(remainingMonths(CAR, AS_OF)).toBe(36);
    expect(remainingMonths(debt({ key: "c", kind: "card", payoffDate: null }), AS_OF)).toBe(
      REFI_CARD_TERM_MONTHS,
    );
    // No payoff date: worked out from the payment.
    const noDate = debt({
      key: "n",
      kind: "student",
      payoffDate: null,
      balanceCents: 100_000,
      aprBps: 0,
      paymentCents: 10_000,
    });
    expect(remainingMonths(noDate, AS_OF)).toBe(10);
  });

  it("maps debts to loan products, and skips what can't be compared", () => {
    expect(refinanceable(CAR, AS_OF)).toMatchObject({ product: "auto", termMonths: 36 });
    expect(refinanceable(debt({ key: "c", kind: "card", payoffDate: null }), AS_OF)?.product).toBe(
      "personal",
    );
    expect(refinanceable(debt({ key: "b", kind: "bnpl" }), AS_OF)).toBeNull();
    expect(refinanceable(debt({ key: "r", kind: "auto", aprBps: null }), AS_OF)).toBeNull();
  });
});

describe("comparing offers", () => {
  it("compares total cost over the same months, fees included, and picks the cheapest", () => {
    const c = compareRefinance(
      CAR,
      [
        offer({
          id: "fee",
          lender: "Northwind",
          aprBps: 519,
          feeCents: 29_900,
          feeLabel: "$299 origination fee",
        }),
        offer({ id: "free", lender: "Harbor", aprBps: 549 }),
        offer({ id: "home", product: "mortgage", aprBps: 100 }),
      ],
      AS_OF,
    )!;
    expect(c.termMonths).toBe(36);
    // Mortgage offers don't refinance a car.
    expect(c.offers.map((s) => s.offer.id)).toEqual(["free", "fee"]);
    const free = c.offers[0];
    expect(free.totalCents).toBe(totalPaidCents(1_802_000, 549, 36));
    expect(free.savingCents).toBe(c.currentTotalCents - free.totalCents);
    // The lower rate loses once its fee is counted.
    expect(c.offers[1].totalCents).toBe(totalPaidCents(1_802_000, 519, 36) + 29_900);
    expect(c.offers[1].breakEvenMonths).toBeGreaterThan(0);
    expect(c.pick?.offer.id).toBe("free");
    expect(c.why).toEqual([
      `The lowest total cost: $${(free.savingCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} less than keeping it, fees included, over 36 months.`,
      `5.49% fixed instead of 6.90%, so the payment goes from $${(c.currentMonthlyCents / 100).toFixed(2)} to $${(free.monthlyCents / 100).toFixed(2)} a month.`,
      "No fee to pay up front.",
    ]);
  });

  it("prefers a fixed rate that saves enough over a cheaper variable one", () => {
    const c = compareRefinance(
      CAR,
      [
        offer({ id: "var", aprBps: 450, rateType: "variable" }),
        offer({ id: "fixed", aprBps: 549 }),
      ],
      AS_OF,
    )!;
    expect(c.offers[0].offer.id).toBe("var");
    expect(c.pick?.offer.id).toBe("fixed");
    expect(c.runnersUp.map((s) => s.offer.id)).toEqual(["var"]);
    expect(c.why[0]).toMatch(
      /^The lowest total cost at a fixed rate: \$[\d,.]+ less than keeping it, fees included, over 36 months\.$/,
    );
    expect(c.why[1]).toMatch(/; a variable rate could go up\.$/);
  });

  it("picks nothing when no offer saves enough to switch", () => {
    const c = compareRefinance(CAR, [offer({ aprBps: 680 })], AS_OF)!;
    expect(c.offers[0].savingCents).toBeGreaterThan(0);
    expect(c.offers[0].savingCents).toBeLessThan(REFI_MIN_SAVING_CENTS);
    expect(c.pick).toBeNull();
    expect(c.why).toEqual([]);
  });

  it("works out a mortgage's break-even on closing costs", () => {
    const home = debt({
      key: "home",
      kind: "mortgage",
      balanceCents: 31_240_000,
      aprBps: 699,
      payoffDate: "2052-10-01",
    });
    const c = compareRefinance(
      home,
      [
        offer({
          product: "mortgage",
          aprBps: 579,
          feeCents: 781_000,
          feeLabel: "Closing costs of 2.5%",
        }),
      ],
      AS_OF,
    )!;
    const s = c.offers[0];
    expect(s.breakEvenMonths).toBe(Math.ceil(781_000 / (c.currentMonthlyCents - s.monthlyCents)));
    expect(c.why[2]).toMatch(/paid back by the lower payment in \d+ months/);
  });
});

describe("the stand-in lender catalog", () => {
  const request = {
    product: "auto" as const,
    amountCents: 1_802_000,
    termMonths: 36,
    creditBand: "good" as const,
    month: "2026-10",
  };

  it("quotes the same rate all month, moving a little month to month", () => {
    const harbor = DEMO_LENDERS.find((l) => l.key === "harbor")!;
    const october = demoQuote(harbor, request)!;
    expect(demoQuote(harbor, request)).toEqual(october);
    expect(Math.abs(october.aprBps - harbor.baseAprBps)).toBeLessThanOrEqual(25);
    expect(october).toMatchObject({ demo: true, product: "auto", termMonths: 36 });
    // A weaker credit band costs more.
    expect(demoQuote(harbor, { ...request, creditBand: "fair" })!.aprBps).toBe(
      october.aprBps + 150,
    );
  });

  it("quotes only the lender's own product, terms and amounts", () => {
    const harbor = DEMO_LENDERS.find((l) => l.key === "harbor")!;
    expect(demoQuote(harbor, { ...request, product: "student" })).toBeNull();
    expect(demoQuote(harbor, { ...request, termMonths: 120 })).toBeNull();
    expect(demoQuote(harbor, { ...request, amountCents: 100 })).toBeNull();
  });
});
