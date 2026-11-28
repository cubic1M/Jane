import { describe, expect, it } from "vitest";
import { taxPaymentNotes, taxPaymentsInYear, type TaxPayment } from "./tax-income";

// T7: which year a federal payment counts toward (IRS Pub. 505 (2026), "When To Pay Estimated Tax").
const fed = (date: string, cents: number): TaxPayment => ({ date, cents, to: "federal" });
const none = { paidEstimates: false, balanceDueCents: null };

describe("which payments count toward a year", () => {
  const all = [
    fed("2026-01-15", 1), // 2025's fourth installment
    fed("2026-02-01", 2),
    fed("2026-04-15", 3),
    fed("2026-12-31", 4),
    fed("2027-01-01", 5), // 2026's fourth installment
    fed("2027-01-15", 6),
    fed("2027-01-31", 7), // balance paid with an early return
    fed("2027-02-01", 8), // 2027's
  ];
  it("2026 is February 1, 2026 to January 31, 2027", () => {
    expect(taxPaymentsInYear(all, 2026).map((p) => p.cents)).toEqual([2, 3, 4, 5, 6, 7]);
  });
  it("2027 starts where 2026 stops", () => {
    expect(taxPaymentsInYear(all, 2027).map((p) => p.cents)).toEqual([8]);
  });
});

describe("the lines for payments counted on a guess", () => {
  const april = [fed("2026-04-14", 200_000)];
  it("the first estimate that equals last year's balance, with no estimates last year", () => {
    expect(
      taxPaymentNotes(april, 2026, { paidEstimates: false, balanceDueCents: 200_000 }),
    ).toEqual([
      "Jane took the $2,000.00 paid on Apr 14 as a 2026 estimate; it may be last year's balance.",
    ]);
  });
  it("no line when estimates were paid last year, the amount differs, or no balance is known", () => {
    expect(taxPaymentNotes(april, 2026, { paidEstimates: true, balanceDueCents: 200_000 })).toEqual(
      [],
    );
    expect(
      taxPaymentNotes(april, 2026, { paidEstimates: false, balanceDueCents: 199_999 }),
    ).toEqual([]);
    expect(taxPaymentNotes(april, 2026, none)).toEqual([]);
  });
  it("April 15 is still the first installment's day; April 16 is not a first-installment guess", () => {
    const prior = { paidEstimates: false, balanceDueCents: 100 };
    expect(taxPaymentNotes([fed("2026-04-15", 100)], 2026, prior)).toHaveLength(1);
    expect(taxPaymentNotes([fed("2026-04-16", 100)], 2026, prior)).toEqual([]);
  });
  it("January 1-15 of the next year needs no line; the 16th to the 31st does", () => {
    expect(taxPaymentNotes([fed("2027-01-15", 100)], 2026, none)).toEqual([]);
    const [late] = taxPaymentNotes([fed("2027-01-16", 100)], 2026, none);
    expect(late).toMatch(/^Jane took the \$1\.00 paid on Jan 16, 2027 as a 2026 payment/);
    expect(taxPaymentNotes([fed("2027-01-31", 100)], 2026, none)).toHaveLength(1);
  });
  it("state payments never get a line", () => {
    expect(taxPaymentNotes([{ date: "2027-01-20", cents: 5, to: "state" }], 2026, none)).toEqual(
      [],
    );
  });
});
