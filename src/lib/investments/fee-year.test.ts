import { describe, expect, it } from "vitest";
import { oneYearOf } from "./fee-year";

// A quarter's fee posted on Jan 2 one year (a holiday) and on Dec 31 the next is 363 days apart:
// a 365-day window then holds five quarters of a fee charged four times a year.

const fee = (date: string, subtype = "management fee", accountId = "brokerage") => ({
  accountId,
  subtype,
  date,
  amountCents: 3_120,
});
const dates = (rows: { date: string }[]) => rows.map((r) => r.date).sort();

describe("a year of fees on a cadence", () => {
  it("keeps the newest four of five quarters that fit in 365 days", () => {
    const five = ["2026-01-02", "2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31"].map((d) =>
      fee(d),
    );
    expect(dates(oneYearOf(five))).toEqual([
      "2026-03-31",
      "2026-06-30",
      "2026-09-30",
      "2026-12-31",
    ]);
  });

  it("keeps the newest twelve of thirteen monthly fees", () => {
    const thirteen = Array.from({ length: 13 }, (_, i) =>
      fee(new Date(Date.UTC(2026, 0, 1 + i * 30)).toISOString().slice(0, 10), "account fee"),
    );
    expect(oneYearOf(thirteen)).toHaveLength(12);
    expect(dates(oneYearOf(thirteen))[0]).toBe(thirteen[1]!.date);
  });

  it("keeps four quarters, and fees with no regular cadence, as charged", () => {
    const four = ["2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31"].map((d) => fee(d));
    expect(oneYearOf(four)).toHaveLength(4);
    const transfers = ["2026-01-05", "2026-01-15", "2026-11-20"].map((d) => fee(d, "transfer fee"));
    expect(oneYearOf(transfers)).toHaveLength(3);
  });

  it("counts each account and kind of fee on its own", () => {
    const rows = [
      ...["2026-01-02", "2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31"].map((d) => fee(d)),
      ...["2026-01-02", "2026-03-31", "2026-06-30", "2026-09-30"].map((d) => fee(d, "account fee")),
      ...["2026-01-02", "2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31"].map((d) =>
        fee(d, "management fee", "ira"),
      ),
    ];
    expect(oneYearOf(rows)).toHaveLength(4 + 4 + 4);
  });
});
