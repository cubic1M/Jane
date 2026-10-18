import { describe, expect, it } from "vitest";
import type { Deadline } from "./deadlines";
import { comingUp, type ComingUpBill } from "./coming-up";

const AS_OF = "2026-10-18";
const OPTIONS = { days: 30, limit: 7 };

const bill = (overrides: Partial<ComingUpBill> = {}): ComingUpBill => ({
  merchant: "Netflix",
  date: "2026-10-25",
  amountCents: 1549,
  ...overrides,
});

const deadline = (overrides: Partial<Deadline> = {}): Deadline => ({
  key: "return:t1",
  title: "Return window for Best Buy",
  date: "2026-10-20",
  kind: "return",
  source: "transactions",
  amountCents: 30_000,
  href: "/transactions?q=Best+Buy",
  detail: null,
  ...overrides,
});

describe("comingUp", () => {
  it("merges bills and deadlines, soonest first", () => {
    const rows = comingUp(
      [bill(), bill({ merchant: "Rent", date: "2026-11-01", amountCents: 150_000 })],
      [
        deadline(),
        deadline({
          key: "entered:e1",
          title: "Use FSA money",
          date: "2026-10-30",
          amountCents: null,
        }),
      ],
      AS_OF,
      OPTIONS,
    );
    expect(rows.map((r) => [r.date, r.label, r.href])).toEqual([
      ["2026-10-20", "Return window for Best Buy", "/deadlines"],
      ["2026-10-25", "Netflix", "/bills"],
      ["2026-10-30", "Use FSA money", "/deadlines"],
      ["2026-11-01", "Rent", "/bills"],
    ]);
    expect(rows.map((r) => r.daysLeft)).toEqual([2, 7, 12, 14]);
    expect(rows[2].amountCents).toBeNull();
  });

  it("shows a bill that's also a deadline once, as the deadline", () => {
    const renewal = deadline({
      key: "renewal:merchant:adobe:2026-10-28",
      title: "Adobe renews",
      date: "2026-10-28",
      kind: "renewal",
      amountCents: 23_988,
    });
    const rows = comingUp(
      [bill({ merchant: "Adobe", date: "2026-10-28", amountCents: 23_988 })],
      [renewal],
      AS_OF,
      OPTIONS,
    );
    expect(rows).toEqual([
      {
        key: "deadline:renewal:merchant:adobe:2026-10-28",
        date: "2026-10-28",
        label: "Adobe renews",
        amountCents: 23_988,
        daysLeft: 10,
        href: "/deadlines",
      },
    ]);
  });

  it("matches a card payment to its bill by date and amount, and keeps the bill's amount", () => {
    const payment = deadline({
      key: "payment:acct:2026-10-22",
      title: "Sapphire payment",
      date: "2026-10-22",
      kind: "payment",
      source: "loans",
      amountCents: 4_500,
    });
    const rows = comingUp(
      [bill({ merchant: "Chase Card", date: "2026-10-22", amountCents: 4_500 })],
      [payment],
      AS_OF,
      OPTIONS,
    );
    expect(rows.map((r) => r.label)).toEqual(["Sapphire payment"]);

    const noAmount = comingUp(
      [bill({ merchant: "Sapphire", date: "2026-10-22", amountCents: 4_500 })],
      [{ ...payment, amountCents: null }],
      AS_OF,
      OPTIONS,
    );
    expect(noAmount).toMatchObject([{ label: "Sapphire payment", amountCents: 4_500 }]);
  });

  it("keeps two different things on the same day", () => {
    const rows = comingUp([bill({ date: "2026-10-20" })], [deadline()], AS_OF, OPTIONS);
    expect(rows.map((r) => r.label)).toEqual(["Netflix", "Return window for Best Buy"]);
  });

  it("leaves out what's past or more than the window away", () => {
    const rows = comingUp(
      [bill({ date: "2026-11-17" }), bill({ merchant: "Gym", date: "2026-11-18" })],
      [deadline({ date: "2026-10-17", source: "entered" }), deadline({ date: AS_OF })],
      AS_OF,
      OPTIONS,
    );
    expect(rows.map((r) => [r.date, r.daysLeft])).toEqual([
      [AS_OF, 0],
      ["2026-11-17", 30],
    ]);
  });

  it("stops at the limit", () => {
    const bills = Array.from({ length: 10 }, (_, i) =>
      bill({ merchant: `Bill ${i}`, date: `2026-10-${String(20 + i).padStart(2, "0")}` }),
    );
    const rows = comingUp(bills, [], AS_OF, OPTIONS);
    expect(rows).toHaveLength(7);
    expect(rows.at(-1)?.label).toBe("Bill 6");
  });
});
