import { describe, expect, it } from "vitest";
import { yearInterest } from "./lender-interest";

const loan = (lastPaymentDate: string | null, ytd = 86_007, readOn = "2026-11-20") => ({
  ytdInterestPaidCents: ytd,
  readOn,
  lastPaymentDate,
  balanceCents: 1_605_374,
  aprBps: 550,
});
const monthly = (first: number, last: number) =>
  Array.from(
    { length: last - first + 1 },
    (_, i) => `2026-${String(first + i).padStart(2, "0")}-08`,
  );

describe("a year's interest paced by payments", () => {
  it("counts the last payment's month when the payments aren't seen", () => {
    expect(yearInterest([loan("2026-11-08")], 2026, "2026-11-20")).toMatchObject({
      from: "lender",
      cents: 93_826,
      payments: 11,
      asOf: "2026-11-08",
    });
  });

  it("counts the payments seen when the data starts well before them", () => {
    const seen = { dates: monthly(6, 11), dataFrom: "2026-01-02" };
    expect(yearInterest([loan("2026-11-08")], 2026, "2026-11-20", seen)).toMatchObject({
      payments: 6,
      cents: Math.round((86_007 * 7) / 6),
    });
  });

  it("doesn't trust payments seen from the data's first weeks, or not monthly", () => {
    const late = {
      dates: ["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"],
      dataFrom: "2026-07-24",
    };
    expect(yearInterest([loan("2026-11-08")], 2026, "2026-11-20", late)?.cents).toBe(93_826);
    const twice = { dates: ["2026-10-01", "2026-10-15", "2026-11-01"], dataFrom: "2026-01-02" };
    expect(yearInterest([loan("2026-11-08")], 2026, "2026-11-20", twice)?.cents).toBe(93_826);
  });

  it("takes the balance and rate with one payment, and the read day without a payment date", () => {
    expect(
      yearInterest([loan("2027-01-08", 7_400, "2027-01-19")], 2027, "2027-01-20"),
    ).toMatchObject({
      from: "rate",
      cents: 88_296,
    });
    expect(yearInterest([loan(null)], 2026, "2026-12-15")).toMatchObject({
      from: "lender",
      payments: null,
      cents: 97_191,
    });
    // A payment date from last year, or after the read, isn't this reading's.
    expect(yearInterest([loan("2025-12-08")], 2026, "2026-11-20")).toMatchObject({
      payments: null,
    });
    expect(yearInterest([loan("2026-11-25")], 2026, "2026-11-30")).toMatchObject({
      payments: null,
    });
  });
});
