import { describe, expect, it } from "vitest";
import { BILL_PAY_MIN_LEFT_CENTS } from "@/config/money-movement";
import { billPlan, dueDateMove, payDate, type DueBill, type ForecastDay } from "./bill-pay";

// Spec step 145, pure: what to pay toward a bill so it lands on time, never overdrawing
// checking's forecast, and when a due date is worth moving.

const TODAY = "2026-10-16";
const bill = (over: Partial<DueBill> = {}): DueBill => ({
  accountId: "card",
  name: "Card",
  kind: "credit",
  dueOn: "2026-10-26",
  minimumCents: 3_500,
  balanceCents: 50_000,
  autopay: null,
  ...over,
});
// A flat forecast from today for 30 days, with a dip on one day if given.
const flat = (cents: number, dip?: { date: string; cents: number }): ForecastDay[] =>
  Array.from({ length: 31 }, (_, i) => {
    const date = new Date(Date.parse(`${TODAY}T00:00:00Z`) + i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return { date, balanceCents: dip && date >= dip.date ? cents - dip.cents : cents };
  });

describe("payDate", () => {
  it("pays a couple of days before the due date, never before tomorrow", () => {
    expect(payDate("2026-10-26", TODAY)).toBe("2026-10-24");
    expect(payDate("2026-10-17", TODAY)).toBe("2026-10-17");
  });
});

describe("billPlan", () => {
  it("leaves a bill the person's own autopay covers alone", () => {
    const covered = bill({ autopay: { date: "2026-10-25", amountCents: 85_000 } });
    expect(billPlan(covered, flat(500_000), TODAY).status).toBe("autopay");
  });

  it("still pays when the autopay is less than the minimum or lands late", () => {
    const small = bill({ autopay: { date: "2026-10-25", amountCents: 1_000 } });
    expect(billPlan(small, flat(500_000), TODAY).status).toBe("pay");
  });

  it("pays the full balance when checking can take it", () => {
    expect(billPlan(bill(), flat(500_000), TODAY)).toMatchObject({
      status: "pay",
      amountCents: 50_000,
      runOn: "2026-10-24",
      full: true,
    });
  });

  it("falls back to the minimum when the balance would dip checking below the cushion later", () => {
    const series = flat(100_000, { date: "2026-11-01", cents: 45_000 });
    expect(billPlan(bill(), series, TODAY)).toMatchObject({
      status: "pay",
      amountCents: 3_500,
      full: false,
    });
  });

  it("never schedules a payment that would overdraw the forecast", () => {
    const series = flat(BILL_PAY_MIN_LEFT_CENTS + 3_000);
    expect(billPlan(bill(), series, TODAY).status).toBe("short");
    // Exactly the cushion left is fine.
    expect(billPlan(bill(), flat(BILL_PAY_MIN_LEFT_CENTS + 3_500), TODAY)).toMatchObject({
      status: "pay",
      amountCents: 3_500,
    });
  });
});

describe("dueDateMove", () => {
  const low = flat(BILL_PAY_MIN_LEFT_CENTS + 1_000);

  it("suggests the day after payday when the bill lands before it and checking runs short", () => {
    expect(dueDateMove(bill(), low, "2026-10-30")).toBe("2026-10-31");
  });

  it("says nothing when the bill comes after payday, or checking can take it", () => {
    expect(dueDateMove(bill(), low, "2026-10-20")).toBeNull();
    expect(dueDateMove(bill(), flat(500_000), "2026-10-30")).toBeNull();
    expect(dueDateMove(bill(), low, null)).toBeNull();
  });
});
