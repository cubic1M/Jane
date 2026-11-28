import { describe, expect, it } from "vitest";
import { sinceLabel } from "./since";

// The "3pm against 7pm" check, either side of UTC midnight: the same person, the same evening.
describe("since, on What Jane knows", () => {
  it("is the person's own day, not UTC's", () => {
    // 9pm on Dec 31 in Los Angeles is Jan 1, 05:00 in UTC.
    const evening = new Date("2027-01-01T05:00:00Z");
    expect(sinceLabel(evening, "America/Los_Angeles")).toBe("Dec 31, 2026");
    // 3pm the same day is still Dec 31 in both.
    const afternoon = new Date("2026-12-31T23:00:00Z");
    expect(sinceLabel(afternoon, "America/Los_Angeles")).toBe("Dec 31, 2026");
    // Someone in UTC themselves reads the UTC day.
    expect(sinceLabel(evening, "UTC")).toBe("Jan 1, 2027");
    // The morning after, in Los Angeles, is Jan 1.
    expect(sinceLabel(new Date("2027-01-01T17:00:00Z"), "America/Los_Angeles")).toBe("Jan 1, 2027");
  });
});
