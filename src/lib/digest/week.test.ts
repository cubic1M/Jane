import { describe, expect, it } from "vitest";
import { validTimezone, weekStart } from "./week";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("weekStart", () => {
  it("is the Monday of the person's own week", () => {
    // Monday 2026-10-19 03:00 UTC is still Sunday evening in California.
    const now = new Date("2026-10-19T03:00:00Z");

    expect(iso(weekStart(now, "America/Los_Angeles"))).toBe("2026-10-12");
    expect(iso(weekStart(now, "Europe/London"))).toBe("2026-10-19");
    expect(iso(weekStart(now, "Asia/Tokyo"))).toBe("2026-10-19");
  });

  it("uses US Pacific when no timezone is stored or it's unknown", () => {
    const now = new Date("2026-10-21T12:00:00Z");

    expect(iso(weekStart(now, null))).toBe("2026-10-19");
    expect(validTimezone("Not/AZone")).toBe("America/Los_Angeles");
  });
});
