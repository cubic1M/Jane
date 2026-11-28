import { describe, expect, it } from "vitest";
import { dayNumber, fromDayNumber } from "./units";

// The two day conversions keep their answers (the pay schedules ask for the same few hundred days
// thousands of times): the second answer is the first, and the two undo each other.
describe("day numbers", () => {
  it("are 0 on 1970-01-01 and count whole UTC days, also across leap days and year ends", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(dayNumber("2024-03-01") - dayNumber("2024-02-28")).toBe(2);
    expect(dayNumber("2026-01-01") - dayNumber("2025-12-31")).toBe(1);
    expect(fromDayNumber(dayNumber("2026-12-31"))).toBe("2026-12-31");
    expect(fromDayNumber(dayNumber("2024-02-29"))).toBe("2024-02-29");
  });

  it("give the same answer when asked again, and for many different days", () => {
    for (let i = 0; i < 2; i++) {
      for (let d = 0; d < 30_000; d += 7) {
        const text = fromDayNumber(d);
        expect(dayNumber(text)).toBe(d);
      }
    }
  });
});
