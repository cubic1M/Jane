import { describe, expect, it } from "vitest";
import {
  daysToMark,
  investmentMonths,
  janeSaved,
  paidOff,
  significantDays,
  transactionEvent,
  type EventTransaction,
  type NetWorthEvent,
} from "./net-worth-events";

// The net worth chart's events: what moved the money, worked out from transactions, balances
// and what Jane did.

const tx = (over: Partial<EventTransaction>): EventTransaction => ({
  date: "2026-10-01",
  amountCents: 10_000,
  name: "Shop",
  pfcPrimary: "GENERAL_MERCHANDISE",
  pfcDetailed: "GENERAL_MERCHANDISE_SUPERSTORES",
  accountType: "depository",
  ...over,
});

describe("a transaction as an event", () => {
  it("names paydays, purchases, bills and refunds, with what they did to net worth", () => {
    expect(
      transactionEvent(tx({ amountCents: -300_000, name: "Acme", pfcPrimary: "INCOME" })),
    ).toMatchObject({ kind: "pay", label: "Payday: Acme", cents: 300_000 });
    expect(transactionEvent(tx({ amountCents: 90_000, name: "Best Buy" }))).toMatchObject({
      kind: "purchase",
      label: "Bought: Best Buy",
      cents: -90_000,
    });
    expect(
      transactionEvent(
        tx({
          name: "Landlord",
          pfcPrimary: "RENT_AND_UTILITIES",
          pfcDetailed: "RENT_AND_UTILITIES_RENT",
        }),
      ),
    ).toMatchObject({ kind: "bill", label: "Bill: Landlord" });
    expect(
      transactionEvent(
        tx({
          name: "Geico",
          pfcPrimary: "GENERAL_SERVICES",
          pfcDetailed: "GENERAL_SERVICES_INSURANCE",
        }),
      ),
    ).toMatchObject({ kind: "bill" });
    expect(transactionEvent(tx({ amountCents: -4_000, name: "Best Buy" }))).toMatchObject({
      kind: "refund",
      cents: 4_000,
    });
  });

  it("links each to its transactions", () => {
    expect(transactionEvent(tx({ name: "Best Buy" }))?.href).toBe("/transactions?q=Best%20Buy");
  });

  it("counts a card payment once, as money moved rather than lost", () => {
    const pay = { pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" };
    expect(transactionEvent(tx({ ...pay, amountCents: 80_000, name: "Chase card" }))).toMatchObject(
      {
        kind: "card_payment",
        cents: 0,
        moved: 80_000,
      },
    );
    // The card's side of the same payment.
    expect(
      transactionEvent(tx({ ...pay, amountCents: -80_000, accountType: "credit" })),
    ).toBeNull();
  });

  it("leaves out money moving between the person's own accounts", () => {
    expect(
      transactionEvent(tx({ pfcPrimary: "TRANSFER_OUT", pfcDetailed: "TRANSFER_OUT_SAVINGS" })),
    ).toBeNull();
    expect(transactionEvent(tx({ amountCents: -5_000, pfcPrimary: "TRANSFER_IN" }))).toBeNull();
  });
});

describe("events from balances and from Jane", () => {
  it("marks the day a loan reached zero", () => {
    expect(
      paidOff({
        id: "car",
        name: "Car loan",
        balances: [
          { date: "2026-08-31", cents: 120_000 },
          { date: "2026-09-30", cents: 40_000 },
          { date: "2026-10-15", cents: 0 },
        ],
      }),
    ).toMatchObject({ date: "2026-10-15", label: "Paid off: Car loan", moved: 40_000 });
    expect(
      paidOff({ id: "c", name: "Card", balances: [{ date: "2026-10-01", cents: 0 }] }),
    ).toBeNull();
  });

  it("marks investment months that moved enough to see", () => {
    const months = investmentMonths({
      id: "brk",
      name: "Brokerage",
      balances: [
        { date: "2026-07-31", cents: 1_000_000 },
        { date: "2026-08-31", cents: 1_010_000 },
        { date: "2026-09-30", cents: 900_000 },
      ],
    });
    expect(months).toEqual([
      expect.objectContaining({
        date: "2026-09-30",
        label: "Investments down: Brokerage",
        cents: -110_000,
      }),
    ]);
  });

  it("marks what Jane got back", () => {
    expect(
      janeSaved({ date: "2026-10-02", title: "Refund from Comcast", cents: 12_000 }),
    ).toMatchObject({
      kind: "jane_saved",
      label: "Jane saved: Refund from Comcast",
      href: "/actions",
    });
    expect(janeSaved({ date: "2026-10-02", title: "Asked", cents: 0 })).toBeNull();
  });
});

describe("which days get a dot", () => {
  const ev = (date: string, cents: number, extra: Partial<NetWorthEvent> = {}): NetWorthEvent => ({
    date,
    kind: "purchase",
    label: "x",
    cents,
    href: "/transactions",
    ...extra,
  });

  it("groups a day's events and keeps the days big enough to see", () => {
    const days = significantDays(
      [ev("2026-10-01", -30_000), ev("2026-10-01", -30_000), ev("2026-10-02", -10_000)],
      10_000_000,
    );
    // Two $300 purchases on one day make a $600 day; a $100 day is too small.
    expect(days).toEqual([expect.objectContaining({ date: "2026-10-01", cents: -60_000 })]);
  });

  it("lowers the bar for a small net worth: 2% of it", () => {
    expect(significantDays([ev("2026-10-02", -10_000)], 400_000)).toHaveLength(1);
  });

  it("counts a card payment by what it moved", () => {
    const card = ev("2026-10-03", 0, { kind: "card_payment", moved: 90_000 });
    expect(significantDays([card], 10_000_000)).toHaveLength(1);
  });

  it("marks only the biggest few in the range on screen, in date order", () => {
    const days = significantDays(
      Array.from({ length: 20 }, (_, i) =>
        ev(`2026-09-${String(i + 1).padStart(2, "0")}`, -(i + 1) * 100_000),
      ),
      100_000_000,
    );
    const marked = daysToMark(days, "2026-09-05", 3);
    expect(marked.map((d) => d.date)).toEqual(["2026-09-18", "2026-09-19", "2026-09-20"]);
    expect(daysToMark(days, "2026-09-19", 12).map((d) => d.date)).toEqual([
      "2026-09-19",
      "2026-09-20",
    ]);
  });
});
