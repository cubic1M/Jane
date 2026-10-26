import { describe, expect, it, vi } from "vitest";
import type { ScopedDb } from "@/lib/db-scoped";
import { cardPaymentOutflows, matchCardPayments, type PairableRow } from "./card-payments";

const accounts = [
  { id: "chk", type: "depository" },
  { id: "card", type: "credit" },
];
const CARD_PAYMENT = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
const row = (id: string, overrides: Partial<PairableRow>): PairableRow => ({
  id,
  accountId: "chk",
  date: "2026-10-01",
  amountCents: 12_345,
  pfcDetailed: null,
  ...overrides,
});
const thanks = (id: string, date: string, amountCents = 12_345) =>
  row(id, { accountId: "card", date, amountCents: -amountCents, pfcDetailed: CARD_PAYMENT });

describe("cardPaymentOutflows", () => {
  it("finds what paid the card when the card company isn't a known name", () => {
    // "BARCLAYCARD US PAYMENT" out of checking; the card posts its thank-you two days later.
    expect(cardPaymentOutflows([row("out", {}), thanks("in", "2026-10-03")], accounts)).toEqual([
      "out",
    ]);
  });

  it("needs the same amount, close in date, out of a bank account", () => {
    const none = (rows: PairableRow[]) => expect(cardPaymentOutflows(rows, accounts)).toEqual([]);
    none([row("out", { amountCents: 12_000 }), thanks("in", "2026-10-01")]);
    none([row("out", {}), thanks("in", "2026-10-08")]);
    none([row("out", { accountId: "card" }), thanks("in", "2026-10-01")]);
    // A refund on the card is not a payment.
    none([row("out", {}), { ...thanks("in", "2026-10-01"), pfcDetailed: null }]);
  });

  it("matches each card payment once, to the nearest outflow", () => {
    const rows = [
      row("early", { date: "2026-09-29" }),
      row("same-day", {}),
      thanks("in", "2026-10-01"),
    ];
    expect(cardPaymentOutflows(rows, accounts)).toEqual(["same-day"]);
  });

  it("leaves an outflow already called a card payment, and its match, alone", () => {
    const rows = [
      row("known", { pfcDetailed: CARD_PAYMENT }),
      row("other", {}),
      thanks("in", "2026-10-01"),
    ];
    expect(cardPaymentOutflows(rows, accounts)).toEqual([]);
  });

  it("only changes outflows with no category or Claude's guess", () => {
    const rent = row("rent", { pfcDetailed: "RENT_AND_UTILITIES_RENT", categorySource: "rule" });
    const guessed = row("guess", {
      pfcDetailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      categorySource: "llm",
    });
    expect(cardPaymentOutflows([rent, thanks("in", "2026-10-01")], accounts)).toEqual([]);
    expect(cardPaymentOutflows([guessed, thanks("in", "2026-10-01")], accounts)).toEqual(["guess"]);
  });
});

describe("matchCardPayments", () => {
  it("recategorizes the matched outflows as card payments, by rule", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const db = {
      accounts: { findMany: vi.fn(async () => accounts) },
      transactions: {
        findMany: vi.fn(async () => [
          { ...row("out", {}), date: new Date("2026-10-01T00:00:00Z") },
          { ...thanks("in", "2026-10-02"), date: new Date("2026-10-02T00:00:00Z") },
        ]),
        updateMany,
      },
    } as unknown as ScopedDb;

    expect(await matchCardPayments(db)).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["out"] } },
      data: { pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: CARD_PAYMENT, categorySource: "rule" },
    });
  });

  it("does nothing without a card", async () => {
    const findMany = vi.fn();
    const db = {
      accounts: { findMany: vi.fn(async () => [{ id: "chk", type: "depository" }]) },
      transactions: { findMany },
    } as unknown as ScopedDb;
    expect(await matchCardPayments(db)).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
