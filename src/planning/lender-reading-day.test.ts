import { describe, expect, it } from "vitest";
import { readingDay } from "./lender-interest";

// A lender's year to date is as of its last payment, when that's in the read's year (Plaid's
// student loans carry last_payment_date in production; the sandbox's custom loan did, Nov 8), else
// as of the sync that read it.
describe("the day a lender's interest so far is as of", () => {
  it("is the last payment, in the read's year", () => {
    expect(readingDay("2026-11-08", "2026-11-20")).toBe("2026-11-08");
  });

  it("is the read day without a payment date, or with one from last year or after the read", () => {
    expect(readingDay(null, "2026-11-20")).toBe("2026-11-20");
    expect(readingDay("2026-12-05", "2027-01-20")).toBe("2027-01-20");
    expect(readingDay("2026-11-25", "2026-11-20")).toBe("2026-11-20");
  });
});
