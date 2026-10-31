import { describe, expect, it } from "vitest";
import { dayLabel, momentLabel, monthLabel } from "./day-label";

describe("dayLabel", () => {
  it("reads a day as a month and day", () => {
    expect(dayLabel("2026-10-26")).toBe("Oct 26");
    expect(dayLabel(new Date("2026-11-08T23:30:00Z"))).toBe("Nov 8");
  });

  it("adds the year when asked", () => {
    expect(dayLabel("2026-10-19", { year: true })).toBe("Oct 19, 2026");
    expect(dayLabel(new Date("2025-01-02T00:00:00Z"), { year: true })).toBe("Jan 2, 2025");
  });
});

describe("monthLabel", () => {
  it("reads a month short with its year by default", () => {
    expect(monthLabel("2026-10")).toBe("Oct 2026");
    expect(monthLabel("2027-01-15")).toBe("Jan 2027");
  });

  it("spells the month out, or leaves the year off, when asked", () => {
    expect(monthLabel("2027-06", { long: true })).toBe("June 2027");
    expect(monthLabel("2026-12", { long: true, year: false })).toBe("December");
    expect(monthLabel("2026-03", { year: false })).toBe("Mar");
  });
});

describe("momentLabel", () => {
  // 9:29pm in Los Angeles on Oct 30 is already Oct 31 in UTC.
  const evening = new Date("2026-10-31T04:29:00Z");

  it("reads a moment as the person's own day", () => {
    expect(momentLabel(evening, "America/Los_Angeles", { year: true })).toBe("Oct 30, 2026");
    expect(momentLabel(evening.toISOString(), "America/New_York")).toBe("Oct 31");
  });
});
