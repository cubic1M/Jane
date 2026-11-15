import { describe, expect, it } from "vitest";
import { dayLabel } from "./day-label";

describe("dayLabel with long", () => {
  it("writes the month in full, with or without the year", () => {
    expect(dayLabel("2026-11-05", { long: true })).toBe("November 5");
    expect(dayLabel("2026-11-05", { long: true, year: true })).toBe("November 5, 2026");
  });

  it("is still short without it", () => {
    expect(dayLabel("2026-11-05")).toBe("Nov 5");
    expect(dayLabel("2026-11-05", { year: true })).toBe("Nov 5, 2026");
  });
});
