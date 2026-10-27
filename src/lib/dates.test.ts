import { describe, expect, it } from "vitest";
import { DAY_MS, addDays, addMonths, daysBetween, isoDay, shiftMonth } from "./dates";

describe("date helpers", () => {
  it("has one day in milliseconds", () => {
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("gives the UTC calendar day, whatever the local time zone", () => {
    expect(isoDay(new Date("2026-10-26T23:59:59.999Z"))).toBe("2026-10-26");
    expect(isoDay(new Date("2026-10-27T00:00:00Z"))).toBe("2026-10-27");
    expect(isoDay(new Date(Date.UTC(2026, 0, 1) - 1))).toBe("2025-12-31");
  });

  it("adds days to a day, across months, years and leap days", () => {
    expect(addDays("2026-10-26", 6)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-10-26", 0)).toBe("2026-10-26");
  });
});

describe("month and day arithmetic", () => {
  it("adds months, held to the last day of a shorter month", () => {
    expect(addMonths("2026-01-15", 1)).toBe("2026-02-15");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });

  it("shifts a month across years", () => {
    expect(shiftMonth("2026-11", 3)).toBe("2027-02");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("counts whole days between two days, either way", () => {
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysBetween("2026-10-31", "2026-10-01")).toBe(-30);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
  });
});
