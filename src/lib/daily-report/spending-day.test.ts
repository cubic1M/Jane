import { describe, expect, it } from "vitest";
import { postedSince, spendingDay } from "./spending-day";
import { spendingInsights, type InsightTransaction } from "@/insights/spending";

const DAY = "2026-11-22";

const tx = (overrides: Partial<InsightTransaction>): InsightTransaction => ({
  date: DAY,
  amountCents: 1_000,
  description: "STORE",
  merchantName: "Store",
  pfcPrimary: "GENERAL_MERCHANDISE",
  pfcDetailed: null,
  pending: false,
  ...overrides,
});

// A usual day: one $20 charge on each of `count` days before DAY.
const usualDays = (count: number, cents = 2_000) =>
  Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.parse(`${DAY}T00:00:00Z`) - (i + 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return tx({ date, amountCents: cents, merchantName: `Usual ${i}` });
  });

describe("spendingDay", () => {
  it("totals the day's spending, the biggest few by merchant, biggest first", () => {
    const day = spendingDay(
      [
        tx({ merchantName: "Whole Foods", amountCents: 4_110 }),
        tx({ merchantName: "Whole Foods", amountCents: 1_000 }),
        tx({ merchantName: "Shell", amountCents: 3_000 }),
        tx({ merchantName: "Netflix", amountCents: 1_549 }),
        tx({ merchantName: "Cafe", amountCents: 500 }),
      ],
      DAY,
    );
    expect(day.totalCents).toBe(10_159);
    expect(day.purchases).toBe(5);
    expect(day.largest).toEqual([
      { merchant: "Whole Foods", cents: 5_110 },
      { merchant: "Shell", cents: 3_000 },
      { merchant: "Netflix", cents: 1_549 },
    ]);
  });

  it("matches the insights page to the cent, since both read the same lines", () => {
    const month = [
      tx({ amountCents: 4_110, merchantName: "Whole Foods" }),
      tx({ amountCents: -1_500, merchantName: "Refund", pfcPrimary: "GENERAL_MERCHANDISE" }),
      tx({ date: "2026-11-05", amountCents: 9_900 }),
      // Not spending: money moved between the person's own accounts.
      tx({
        amountCents: 50_000,
        pfcPrimary: "TRANSFER_OUT",
        pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      }),
    ];
    const insights = spendingInsights(month, { asOf: DAY, monthCount: 1 });
    const sameDayOnly = spendingInsights(
      month.filter((t) => t.date === DAY),
      { asOf: DAY, monthCount: 1 },
    );
    expect(spendingDay(month, DAY).totalCents).toBe(sameDayOnly.months.at(-1)?.spendingCents);
    expect(insights.months.at(-1)?.spendingCents).toBe(4_110 - 1_500 + 9_900);
  });

  it("leaves pending charges out of the total, as the pages do, and counts them", () => {
    const day = spendingDay(
      [tx({ amountCents: 2_000 }), tx({ amountCents: 9_999, pending: true })],
      DAY,
    );
    expect(day.totalCents).toBe(2_000);
    expect(day.pending).toBe(1);
  });

  it("counts a pending charge as pending only if it would be spending once settled", () => {
    const day = spendingDay(
      [
        tx({ amountCents: 2_000, pending: true }),
        // A pending transfer out and a pending card payment will never be spending.
        tx({
          amountCents: 50_000,
          pending: true,
          pfcPrimary: "TRANSFER_OUT",
          pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
        }),
        tx({
          amountCents: 30_000,
          pending: true,
          pfcPrimary: "LOAN_PAYMENTS",
          pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        }),
      ],
      DAY,
    );
    expect(day.pending).toBe(1);
  });

  it("says a day of only refunds is not a purchase", () => {
    const day = spendingDay([tx({ amountCents: -1_500 })], DAY);
    expect(day).toMatchObject({ totalCents: -1_500, purchases: 0, largest: [] });
  });

  it("is unusual only well above a usual day, with enough days to know one", () => {
    const big = tx({ amountCents: 20_000, merchantName: "Big" });
    // A usual day is $20: $200 is 10 times that, and far above it.
    expect(spendingDay([...usualDays(20), big], DAY)).toMatchObject({
      usualCents: 2_000,
      unusual: true,
    });
    // Not enough days with spending to call any day usual.
    expect(spendingDay([...usualDays(5), big], DAY)).toMatchObject({
      usualCents: null,
      unusual: false,
    });
    // Over the multiple but under the dollar floor: a small day is never news.
    expect(spendingDay([...usualDays(20, 100), tx({ amountCents: 1_000 })], DAY).unusual).toBe(
      false,
    );
    // A busy day, not a well-above one.
    expect(spendingDay([...usualDays(20), tx({ amountCents: 4_000 })], DAY).unusual).toBe(false);
  });
});

describe("postedSince", () => {
  // The report on the 23rd: yesterday is the 22nd. A bank posts a charge a day or two late.
  const YESTERDAY = "2026-11-22";
  const line = (id: string, overrides: Partial<InsightTransaction> = {}) =>
    tx({ id, date: "2026-11-20", amountCents: 3_500, merchantName: `Diner ${id}`, ...overrides });

  it("lists the lines that arrived since the last report with a date before yesterday", () => {
    const posted = postedSince(
      [line("a"), line("b", { amountCents: 1_200 }), line("old", { amountCents: 9_900 })],
      new Set(["a", "b"]),
      YESTERDAY,
    );
    expect(posted).toEqual({
      count: 2,
      totalCents: 4_700,
      largest: [
        { merchant: "Diner a", cents: 3_500 },
        { merchant: "Diner b", cents: 1_200 },
      ],
    });
  });

  it("leaves out yesterday's own lines (they are in the day), lines too old to be news and pending ones", () => {
    const posted = postedSince(
      [
        line("today", { date: YESTERDAY }),
        line("ancient", { date: "2026-11-01" }),
        line("pending", { pending: true }),
        line("fine", { amountCents: 500 }),
      ],
      new Set(["today", "ancient", "pending", "fine"]),
      YESTERDAY,
    );
    expect(posted).toMatchObject({ count: 1, totalCents: 500 });
  });

  it("is empty when nothing arrived: a line not in the arrived set is not listed", () => {
    expect(postedSince([line("a")], new Set(), YESTERDAY)).toEqual({
      count: 0,
      totalCents: 0,
      largest: [],
    });
  });

  it("counts a refund against the charges, as the pages do", () => {
    const posted = postedSince(
      [line("a"), line("r", { amountCents: -1_000, merchantName: "Refund" })],
      new Set(["a", "r"]),
      YESTERDAY,
    );
    expect(posted).toMatchObject({ count: 1, totalCents: 2_500 });
  });
});
