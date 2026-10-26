import { describe, expect, it } from "vitest";
import { DAY_MS, addDays, isoDay } from "./dates";

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
