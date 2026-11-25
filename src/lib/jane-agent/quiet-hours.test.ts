import { describe, expect, it } from "vitest";
import { inQuietHours, localMonthStart, localTime } from "./quiet-hours";

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

// CodeRabbit part 2: a month starts at midnight of the 1st on the person's clock. UTC's midnight
// put July 31, 8pm in Los Angeles inside August.
describe("localMonthStart", () => {
  it("is the person's midnight on the 1st, not UTC's", () => {
    const august = new Date("2026-08-01T07:30:00Z");
    expect(localMonthStart(august, "America/Los_Angeles").toISOString()).toBe(
      "2026-08-01T07:00:00.000Z",
    );
    // July 31, 8pm in Los Angeles is not in August.
    expect(new Date("2026-08-01T03:00:00Z") < localMonthStart(august, "America/Los_Angeles")).toBe(
      true,
    );
  });
  it("is UTC's midnight in UTC, and ahead of it east of the prime meridian", () => {
    expect(localMonthStart(new Date("2026-08-15T12:00:00Z"), "UTC").toISOString()).toBe(
      "2026-08-01T00:00:00.000Z",
    );
    expect(localMonthStart(new Date("2026-08-15T12:00:00Z"), "Asia/Tokyo").toISOString()).toBe(
      "2026-07-31T15:00:00.000Z",
    );
  });
  it("follows a clock change", () => {
    // Daylight time ends on November 1 at 2am: midnight of the 1st is still daylight time.
    expect(
      localMonthStart(new Date("2026-11-20T12:00:00Z"), "America/Los_Angeles").toISOString(),
    ).toBe("2026-11-01T07:00:00.000Z");
    expect(
      localMonthStart(new Date("2026-12-20T12:00:00Z"), "America/Los_Angeles").toISOString(),
    ).toBe("2026-12-01T08:00:00.000Z");
  });
});
