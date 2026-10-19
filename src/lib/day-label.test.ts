import { describe, expect, it } from "vitest";
import { dayLabel } from "./day-label";

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
