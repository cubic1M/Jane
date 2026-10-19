import { describe, expect, it } from "vitest";
import { bnplPlans, bnplProviderOf, type BnplPayment } from "./bnpl";

const pay = (date: string, amountCents: number, merchantName: string | null, description = "") => ({
  date,
  amountCents,
  merchantName,
  description: description || (merchantName ?? "").toUpperCase(),
});

describe("buy now, pay later plans", () => {
  it("knows the three companies by merchant or description", () => {
    expect(bnplProviderOf(pay("2026-10-01", 100, "Affirm"))?.key).toBe("affirm");
    expect(bnplProviderOf(pay("2026-10-01", 100, null, "KLARNA* PAY IN 4"))?.key).toBe("klarna");
    expect(bnplProviderOf(pay("2026-10-01", 100, null, "AFTERPAY US INC"))?.key).toBe("afterpay");
    expect(bnplProviderOf(pay("2026-10-01", 100, "Target"))).toBeNull();
  });

  it("reads a Pay in 4 halfway through: two left, what's left and the last day", () => {
    const [plan] = bnplPlans(
      [pay("2026-10-02", 6225, "Klarna"), pay("2026-10-16", 6225, "Klarna")],
      "2026-10-19",
    );
    expect(plan).toMatchObject({
      key: "klarna:6225",
      kind: "pay_in_4",
      paymentsMade: 2,
      paymentsLeft: 2,
      balanceCents: 12_450,
      nextDate: "2026-10-30",
      payoffDate: "2026-11-13",
    });
  });

  it("drops a Pay in 4 once all four are paid", () => {
    const dates = ["2026-09-01", "2026-09-15", "2026-09-29", "2026-10-13"];
    expect(
      bnplPlans(
        dates.map((d) => pay(d, 2500, "Afterpay")),
        "2026-10-19",
      ),
    ).toEqual([]);
  });

  it("drops a Pay in 4 whose next payment never came", () => {
    expect(
      bnplPlans(
        [pay("2026-08-01", 2500, "Afterpay"), pay("2026-08-15", 2500, "Afterpay")],
        "2026-10-19",
      ),
    ).toEqual([]);
  });

  it("treats one recent Klarna or Afterpay payment as the start of a Pay in 4", () => {
    const [plan] = bnplPlans([pay("2026-10-15", 3000, "Afterpay")], "2026-10-19");
    expect(plan).toMatchObject({ kind: "pay_in_4", paymentsLeft: 3, balanceCents: 9000 });
  });

  it("reads monthly payments as a plan with an unknown balance and end", () => {
    const dates = ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"];
    const [plan] = bnplPlans(
      dates.map((d) => pay(d, 8950, "Affirm")),
      "2026-10-19",
    );
    expect(plan).toMatchObject({
      key: "affirm:8950",
      kind: "monthly",
      paymentsMade: 5,
      nextDate: "2026-10-31",
      balanceCents: null,
      payoffDate: null,
    });
  });

  it("drops a monthly plan with no payment for too long", () => {
    const dates = ["2026-04-01", "2026-05-01", "2026-06-01"];
    expect(
      bnplPlans(
        dates.map((d) => pay(d, 8950, "Affirm")),
        "2026-10-19",
      ),
    ).toEqual([]);
  });

  it("keeps two plans at one company apart by their payment", () => {
    const rows: BnplPayment[] = [
      pay("2026-10-02", 6225, "Klarna"),
      pay("2026-10-05", 1999, "Klarna"),
      pay("2026-10-16", 6225, "Klarna"),
    ];
    const plans = bnplPlans(rows, "2026-10-19");
    expect(plans.map((p) => p.key)).toEqual(["klarna:6225", "klarna:1999"]);
  });

  it("ignores refunds, other merchants and payments after the day", () => {
    expect(
      bnplPlans(
        [
          pay("2026-10-10", -6225, "Klarna"),
          pay("2026-10-10", 6225, "Target"),
          pay("2026-10-25", 6225, "Klarna"),
        ],
        "2026-10-19",
      ),
    ).toEqual([]);
  });
});
