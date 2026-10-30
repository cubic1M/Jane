import { describe, expect, it } from "vitest";
import {
  kindOf,
  linesFor,
  monthsEnding,
  spendingInsights,
  spendingLines,
  type InsightTransaction,
} from "./spending";
import { typicalMonthlySpending } from "./typical-month";

const t = (overrides: Partial<InsightTransaction>): InsightTransaction => ({
  date: "2026-10-05",
  amountCents: 1000,
  description: "SHOP",
  merchantName: null,
  pfcPrimary: "GENERAL_MERCHANDISE",
  pfcDetailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
  pending: false,
  ...overrides,
});

const run = (rows: InsightTransaction[]) =>
  spendingInsights(rows, { asOf: "2026-10-18", monthCount: 3 });

describe("spendingInsights", () => {
  it("covers the last months, oldest first", () => {
    expect(monthsEnding("2026-01-31", 3)).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(run([]).months.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("reconciles exactly with the transactions it counts", () => {
    const rows = [
      t({ amountCents: 1234 }),
      t({
        amountCents: 5000,
        pfcPrimary: "FOOD_AND_DRINK",
        pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
        merchantName: "Grocer",
      }),
      t({
        amountCents: 199,
        date: "2026-09-30",
        pfcPrimary: "BANK_FEES",
        pfcDetailed: "BANK_FEES_ATM_FEES",
      }),
      t({ amountCents: -250000, pfcPrimary: "INCOME", pfcDetailed: "INCOME_SALARY" }),
    ];
    const insights = run(rows);
    const october = insights.months.find((m) => m.month === "2026-10")!;
    const september = insights.months.find((m) => m.month === "2026-09")!;

    expect(october).toEqual({ month: "2026-10", spendingCents: 6234, incomeCents: 250000 });
    expect(september.spendingCents).toBe(199);
    const categoryTotal = insights.categoriesByMonth["2026-10"].reduce(
      (sum, c) => sum + c.cents,
      0,
    );
    expect(categoryTotal).toBe(october.spendingCents);
  });

  it("doesn't count card payments, transfers or pending charges", () => {
    const rows = [
      t({
        amountCents: 80000,
        pfcPrimary: "LOAN_PAYMENTS",
        pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
      }),
      t({
        amountCents: -80000,
        pfcPrimary: "TRANSFER_IN",
        pfcDetailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
      }),
      t({
        amountCents: 30000,
        pfcPrimary: "TRANSFER_OUT",
        pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      }),
      t({ amountCents: 999, pending: true }),
    ];

    expect(rows.map(kindOf)).toEqual(["ignored", "ignored", "ignored", "ignored"]);
    expect(run(rows).months.every((m) => m.spendingCents === 0 && m.incomeCents === 0)).toBe(true);
  });

  it("nets refunds against their category", () => {
    const insights = run([
      t({ amountCents: 5000 }),
      t({ amountCents: -2000, description: "RETURN" }),
    ]);

    expect(insights.categoriesByMonth["2026-10"]).toEqual([{ category: "Shopping", cents: 3000 }]);
  });

  it("ranks merchants and shows the biggest month-over-month changes", () => {
    const insights = run([
      t({ merchantName: "Grocer", amountCents: 9000, pfcPrimary: "FOOD_AND_DRINK" }),
      t({
        merchantName: "Grocer",
        amountCents: 1000,
        date: "2026-09-10",
        pfcPrimary: "FOOD_AND_DRINK",
      }),
      t({ merchantName: "Shop", amountCents: 3000 }),
      t({ merchantName: "Shop", amountCents: 3000, date: "2026-09-10" }),
    ]);

    expect(insights.topMerchants.map((m) => [m.merchant, m.cents, m.count])).toEqual([
      ["Grocer", 10000, 2],
      ["Shop", 6000, 2],
    ]);
    expect(insights.changes).toEqual([
      { category: "Food and drink", beforeCents: 1000, afterCents: 9000, changeCents: 8000 },
    ]);
  });

  it("never counts money in with no category as a refund (night debugger, 10-30)", () => {
    // A servicemember's pay with no category: two paychecks took "Spent this month" to -$2.6k.
    const pay = t({
      amountCents: -241_000,
      description: "DEPOSIT - DFAS-CLEVELAND MIL PAY",
      pfcPrimary: null,
      pfcDetailed: null,
    });
    expect(kindOf(pay)).toBe("ignored");
    const october = run([t({ amountCents: 9_500 }), pay, { ...pay, date: "2026-10-15" }]).months.at(
      -1,
    )!;
    expect(october).toEqual({ month: "2026-10", spendingCents: 9_500, incomeCents: 0 });
    // Money out with no category is still spending.
    expect(kindOf(t({ pfcPrimary: null, pfcDetailed: null }))).toBe("spending");
  });

  it("never shows a month's spending below $0: refunds net only against their own category", () => {
    const insights = run([
      t({ amountCents: 2_000, pfcPrimary: "FOOD_AND_DRINK" }),
      // A big return in a month with little else bought there.
      t({ amountCents: -50_000, description: "RETURN" }),
      t({ amountCents: 1_000, date: "2026-09-02" }),
    ]);
    const october = insights.months.at(-1)!;
    expect(october.spendingCents).toBe(2_000);
    const shown = insights.categoriesByMonth["2026-10"].reduce((sum, c) => sum + c.cents, 0);
    expect(october.spendingCents).toBe(shown);
  });

  it("keeps every month at $0 or more, whatever comes in (invariant)", () => {
    const primaries = [null, "FOOD_AND_DRINK", "GENERAL_MERCHANDISE", "INCOME", "TRANSFER_IN"];
    let seed = 7;
    const next = () => (seed = (seed * 48_271) % 2_147_483_647) / 2_147_483_647;
    const rows = Array.from({ length: 400 }, () =>
      t({
        date: `2026-${["08", "09", "10"][Math.floor(next() * 3)]}-1${Math.floor(next() * 9)}`,
        amountCents: Math.round((next() - 0.6) * 300_000),
        pfcPrimary: primaries[Math.floor(next() * primaries.length)],
        pfcDetailed: null,
      }),
    );
    for (const m of run(rows).months) {
      expect(m.spendingCents).toBeGreaterThanOrEqual(0);
      expect(m.incomeCents).toBeGreaterThanOrEqual(0);
    }
  });

  it("counts cash deposits marked as income as income (src/categorize/cash-income.ts)", () => {
    const tips = t({ amountCents: -28_000, pfcPrimary: "INCOME", pfcDetailed: "INCOME_OTHER" });
    expect(kindOf(tips)).toBe("income");
    expect(
      kindOf(
        t({ amountCents: -28_000, pfcPrimary: "TRANSFER_IN", pfcDetailed: "TRANSFER_IN_DEPOSIT" }),
      ),
    ).toBe("ignored");
  });

  it("labels uncategorized spending", () => {
    expect(
      run([t({ pfcPrimary: null, pfcDetailed: null })]).categoriesByMonth["2026-10"][0].category,
    ).toBe("Uncategorized");
  });
});

describe("spendingLines", () => {
  // A messy few months: refunds, card payments, transfers both ways, pending charges, income,
  // a month before the range, merchants with and without Plaid's name.
  const rows: InsightTransaction[] = [
    t({ id: "a", accountId: "chk", merchantName: "Grocer", pfcPrimary: "FOOD_AND_DRINK" }),
    t({
      id: "b",
      accountId: "card",
      merchantName: "Grocer",
      pfcPrimary: "FOOD_AND_DRINK",
      date: "2026-10-12",
      amountCents: 4321,
    }),
    t({
      id: "c",
      accountId: "card",
      merchantName: "Grocer",
      pfcPrimary: "FOOD_AND_DRINK",
      date: "2026-10-13",
      amountCents: -500,
    }),
    t({
      id: "d",
      accountId: "card",
      description: "SQ *BLUE BOTTLE #123",
      pfcPrimary: "FOOD_AND_DRINK",
      date: "2026-09-03",
      amountCents: 650,
    }),
    t({
      id: "e",
      accountId: "card",
      description: "BLUE BOTTLE 456",
      pfcPrimary: "FOOD_AND_DRINK",
      date: "2026-08-03",
      amountCents: 700,
    }),
    t({ id: "f", accountId: "chk", amountCents: 12_000, date: "2026-09-20" }),
    t({ id: "g", accountId: "chk", amountCents: -3_000, date: "2026-09-22" }),
    t({ id: "h", accountId: "chk", pfcPrimary: null, pfcDetailed: null, amountCents: 999 }),
    t({
      id: "i",
      accountId: "chk",
      amountCents: 80_000,
      pfcPrimary: "LOAN_PAYMENTS",
      pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
      description: "CRD AUTOPAY",
    }),
    t({
      id: "j",
      accountId: "card",
      amountCents: -80_000,
      pfcPrimary: "LOAN_PAYMENTS",
      pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
      description: "PAYMENT THANK YOU",
    }),
    t({
      id: "k",
      accountId: "chk",
      amountCents: 50_000,
      pfcPrimary: "TRANSFER_OUT",
      pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      description: "ONLINE TRANSFER",
    }),
    t({
      id: "l",
      accountId: "sav",
      amountCents: -50_000,
      pfcPrimary: "TRANSFER_IN",
      pfcDetailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
      description: "ONLINE TRANSFER",
    }),
    t({ id: "m", accountId: "chk", amountCents: 2_500, pending: true }),
    t({
      id: "n",
      accountId: "chk",
      amountCents: -400_000,
      pfcPrimary: "INCOME",
      pfcDetailed: "INCOME_SALARY",
    }),
    t({
      id: "o",
      accountId: "chk",
      amountCents: 7_000,
      pfcPrimary: "LOAN_PAYMENTS",
      pfcDetailed: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
      description: "NELNET",
    }),
    t({ id: "p", accountId: "chk", amountCents: 9_999, date: "2026-07-31" }),
  ];
  const opts = { asOf: "2026-10-18", monthCount: 3 };
  const accountNames = new Map([
    ["chk", "Checking ····1234"],
    ["card", "Freedom ····9876"],
  ]);
  const insights = spendingInsights(rows, opts);
  const lines = spendingLines(rows, { ...opts, accountNames });
  const sum = (ls: { cents: number }[]) => ls.reduce((s, l) => s + l.cents, 0);

  it("lists each category row's transactions, adding up to its total in every month", () => {
    for (const month of monthsEnding(opts.asOf, opts.monthCount)) {
      for (const c of insights.categoriesByMonth[month]) {
        expect(sum(linesFor(lines, { month, category: c.category }))).toBe(c.cents);
      }
      const total = insights.months.find((m) => m.month === month)!.spendingCents;
      expect(sum(linesFor(lines, { month }))).toBe(total);
    }
    expect(insights.categoriesByMonth["2026-10"].length).toBeGreaterThan(1);
  });

  it("lists each merchant row's transactions, adding up to its total", () => {
    for (const m of insights.topMerchants) {
      expect(sum(linesFor(lines, { merchant: m.merchant }))).toBe(m.cents);
    }
    expect(linesFor(lines, { merchant: "Blue Bottle" }).map((l) => l.cents)).toEqual([650, 700]);
  });

  it("lists each change row's two months, adding up to before and after", () => {
    const [before, after] = monthsEnding(opts.asOf, 2);
    expect(insights.changes.length).toBeGreaterThan(0);
    for (const c of insights.changes) {
      expect(sum(linesFor(lines, { month: after, category: c.category }))).toBe(c.afterCents);
      expect(sum(linesFor(lines, { month: before, category: c.category }))).toBe(c.beforeCents);
    }
  });

  it("leaves out card payments, transfers between own accounts, pending and income", () => {
    const words = lines.map((l) => l.merchant).join(" ");
    expect(words).not.toMatch(/AUTOPAY|THANK YOU|TRANSFER/i);
    expect(lines.some((l) => l.cents === 2_500 || l.cents === -400_000)).toBe(false);
    // A student loan payment is spending; the July charge is before the range.
    expect(lines.some((l) => l.cents === 7_000)).toBe(true);
    expect(lines.some((l) => l.date === "2026-07-31")).toBe(false);
  });

  it("is newest first, with the clean merchant and the account's name", () => {
    expect(lines.map((l) => l.date)).toEqual([...lines.map((l) => l.date)].sort().reverse());
    expect(lines[0]).toEqual({
      date: "2026-10-13",
      merchant: "Grocer",
      account: "Freedom ····9876",
      cents: -500,
      category: "Food and drink",
    });
  });
});

describe("typicalMonthlySpending", () => {
  it("averages the complete months before this one, leaving this month out", () => {
    const rows = [
      t({ date: "2026-08-02", amountCents: 30_000 }),
      t({ date: "2026-09-10", amountCents: 50_000 }),
      // This month is still going: left out.
      t({ date: "2026-10-05", amountCents: 999_000 }),
    ];
    expect(typicalMonthlySpending(rows, "2026-10-18", 2)).toBe(40_000);
    expect(typicalMonthlySpending([], "2026-10-18", 2)).toBe(0);
  });

  it("leaves out a month the data starts partway through", () => {
    // Night QA 10-30: statements from Jul 28 made July a month of four days, and the emergency
    // fund goal "3 months of your own average spending" came out about a third low.
    const rows = [
      t({ date: "2026-07-28", amountCents: 5_000 }),
      t({ date: "2026-08-10", amountCents: 300_000 }),
      t({ date: "2026-09-10", amountCents: 340_000 }),
    ];
    expect(typicalMonthlySpending(rows, "2026-10-18", 3)).toBe(320_000);
    // Only partial months: nothing to average yet.
    expect(typicalMonthlySpending(rows.slice(0, 1), "2026-08-18", 1)).toBe(0);
  });
});
