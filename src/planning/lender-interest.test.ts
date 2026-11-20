import { describe, expect, it } from "vitest";
import { LENDER_INTEREST_MIN_DAYS } from "@/config/tax";
import { yearInterest } from "./lender-interest";

const loan = (ytd: number | null, asOf: string | null) => ({
  ytdInterestPaidCents: ytd,
  asOf,
  balanceCents: 1_605_374,
  aprBps: 550,
});

describe("a year's interest from the lender", () => {
  it("is paced by the day the lender's figure was read, whatever today is", () => {
    const read = [loan(86_007, "2026-11-20")];
    const figures = ["2026-11-20", "2026-12-01", "2026-12-31"].map(
      (today) => yearInterest(read, 2026, today)?.cents,
    );
    expect(figures).toEqual([97_191, 97_191, 97_191]);
  });

  it("falls back to balance and rate before the floor, and for another year's reading", () => {
    expect(LENDER_INTEREST_MIN_DAYS).toBeGreaterThanOrEqual(59);
    expect(yearInterest([loan(1_450, "2027-01-20")], 2027, "2027-01-20")).toMatchObject({
      from: "rate",
      cents: 88_296,
    });
    expect(yearInterest([loan(93_100, "2026-12-15")], 2027, "2027-01-20")?.from).toBe("rate");
    expect(yearInterest([loan(93_100, "2026-12-15")], 2026, "2027-01-20")).toMatchObject({
      from: "lender",
      asOf: "2026-12-15",
    });
  });

  it("counts a reading dated after today as read today", () => {
    expect(yearInterest([loan(86_007, "2026-11-25")], 2026, "2026-11-20")?.cents).toBe(97_191);
  });
});
