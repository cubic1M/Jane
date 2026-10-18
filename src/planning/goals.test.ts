import { describe, expect, it } from "vitest";
import { goalProgress, monthsUntil } from "./goals";

// Worked out by hand.
describe("monthsUntil", () => {
  it("counts whole months by day of month", () => {
    expect(monthsUntil("2026-10-20", "2027-04-20")).toBe(6);
    expect(monthsUntil("2026-10-20", "2027-01-15")).toBe(2);
    expect(monthsUntil("2026-10-20", "2026-10-31")).toBe(1);
    expect(monthsUntil("2026-10-20", "2028-10-20")).toBe(24);
  });
});

describe("goalProgress", () => {
  it("$6,000 by Apr 20 with $1,500 saved: $750.00 a month for 6 months", () => {
    expect(
      goalProgress(
        { targetCents: 600_000, savedCents: 150_000, targetDate: "2027-04-20" },
        "2026-10-20",
      ),
    ).toEqual({
      status: "on_the_way",
      savedCents: 150_000,
      leftCents: 450_000,
      percent: 25,
      monthsLeft: 6,
      monthlyCents: 75_000,
    });
  });

  it("$1,000 by Jan 15 from nothing: $500.00 a month for 2 months", () => {
    expect(
      goalProgress({ targetCents: 100_000, savedCents: 0, targetDate: "2027-01-15" }, "2026-10-20"),
    ).toMatchObject({ monthsLeft: 2, monthlyCents: 50_000 });
  });

  it("rounds the monthly amount up to the cent: $666.67 over 3 months is $222.23", () => {
    expect(
      goalProgress(
        { targetCents: 100_000, savedCents: 33_333, targetDate: "2027-01-20" },
        "2026-10-20",
      ),
    ).toMatchObject({ leftCents: 66_667, monthsLeft: 3, monthlyCents: 22_223 });
  });

  it("knows when a goal is reached or its date has passed", () => {
    expect(
      goalProgress(
        { targetCents: 100_000, savedCents: 120_000, targetDate: "2027-01-01" },
        "2026-10-20",
      ),
    ).toEqual({ status: "reached", savedCents: 120_000, percent: 100 });
    expect(
      goalProgress(
        { targetCents: 100_000, savedCents: 40_000, targetDate: "2026-10-01" },
        "2026-10-20",
      ),
    ).toEqual({ status: "date_passed", savedCents: 40_000, leftCents: 60_000, percent: 40 });
  });

  it("treats a negative balance as nothing saved", () => {
    expect(
      goalProgress(
        { targetCents: 100_000, savedCents: -5_000, targetDate: "2027-10-20" },
        "2026-10-20",
      ),
    ).toMatchObject({ savedCents: 0, percent: 0, monthlyCents: Math.ceil(100_000 / 12) });
  });
});
