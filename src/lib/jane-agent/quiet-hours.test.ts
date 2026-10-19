import { describe, expect, it } from "vitest";
import { inQuietHours, localTime } from "./quiet-hours";

// Spec step 82: quiet hours are 9pm to 8am in the person's own timezone.

describe("localTime", () => {
  it("reads the date and hour in the person's timezone", () => {
    const now = new Date("2026-10-18T03:30:00Z");
    expect(localTime(now, "America/New_York")).toEqual({ date: "2026-10-17", hour: 23 });
    expect(localTime(now, "Europe/London")).toEqual({ date: "2026-10-18", hour: 4 });
    expect(localTime(now, "UTC")).toEqual({ date: "2026-10-18", hour: 3 });
  });

  it("uses US Pacific when the timezone is unset or unknown", () => {
    const now = new Date("2026-10-18T15:00:00Z");
    expect(localTime(now, null)).toEqual({ date: "2026-10-18", hour: 8 });
    expect(localTime(now, "Not/AZone")).toEqual({ date: "2026-10-18", hour: 8 });
  });

  it("says midnight is hour 0", () => {
    expect(localTime(new Date("2026-10-18T00:00:00Z"), "UTC").hour).toBe(0);
  });
});

describe("inQuietHours", () => {
  const at = (iso: string) => new Date(iso);

  it("is quiet from 9pm until 8am local time", () => {
    // 8:59pm, 9pm, 3am, 7:59am and 8am in New York (EDT, UTC-4).
    expect(inQuietHours(at("2026-10-19T00:59:00Z"), "America/New_York")).toBe(false);
    expect(inQuietHours(at("2026-10-19T01:00:00Z"), "America/New_York")).toBe(true);
    expect(inQuietHours(at("2026-10-19T07:00:00Z"), "America/New_York")).toBe(true);
    expect(inQuietHours(at("2026-10-19T11:59:00Z"), "America/New_York")).toBe(true);
    expect(inQuietHours(at("2026-10-19T12:00:00Z"), "America/New_York")).toBe(false);
  });

  it("depends on where the person lives", () => {
    // 7am in Los Angeles is 3pm in London.
    const now = at("2026-10-18T14:00:00Z");
    expect(inQuietHours(now, "America/Los_Angeles")).toBe(true);
    expect(inQuietHours(now, "Europe/London")).toBe(false);
    expect(inQuietHours(now, "Pacific/Honolulu")).toBe(true);
  });

  it("follows daylight saving time", () => {
    // 8:30am in Los Angeles in July (PDT) is still 7:30am in December (PST).
    expect(inQuietHours(at("2026-07-01T15:30:00Z"), "America/Los_Angeles")).toBe(false);
    expect(inQuietHours(at("2026-12-01T15:30:00Z"), "America/Los_Angeles")).toBe(true);
  });

  it("takes other windows, including ones that don't cross midnight", () => {
    const noon = at("2026-10-18T12:00:00Z");
    expect(inQuietHours(noon, "UTC", { start: 11, end: 13 })).toBe(true);
    expect(inQuietHours(noon, "UTC", { start: 13, end: 11 })).toBe(false);
    expect(inQuietHours(noon, "UTC", { start: 9, end: 9 })).toBe(false);
  });
});
