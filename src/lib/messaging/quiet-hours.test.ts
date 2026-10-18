import { describe, expect, it } from "vitest";
import { inQuietHours, isQuietHour, sendTime } from "./quiet-hours";

const at = (iso: string) => new Date(iso);

describe("quiet hours (spec step 78)", () => {
  it("is quiet from 9pm to 8am", () => {
    expect([20, 21, 23, 0, 7, 8].map(isQuietHour)).toEqual([false, true, true, true, true, false]);
  });

  it("sends at once during the day, in the person's own timezone", () => {
    // 10am in New York.
    const now = at("2026-11-16T15:00:00Z");
    expect(sendTime(now, "America/New_York")).toEqual(now);
    expect(inQuietHours(now, "America/New_York")).toBe(false);
  });

  it("waits until 8am the next morning after 9pm", () => {
    // 10pm in New York (EST, UTC-5) → 8am there, 13:00 UTC the next day.
    expect(sendTime(at("2026-11-17T03:00:00Z"), "America/New_York")).toEqual(
      at("2026-11-17T13:00:00Z"),
    );
    // 9:00pm exactly is quiet.
    expect(inQuietHours(at("2026-11-17T02:00:00Z"), "America/New_York")).toBe(true);
  });

  it("waits until 8am the same morning before 8am", () => {
    // 6:30am in Los Angeles (PST, UTC-8) → 8am, 16:00 UTC.
    expect(sendTime(at("2026-11-16T14:30:00Z"), "America/Los_Angeles")).toEqual(
      at("2026-11-16T16:00:00Z"),
    );
  });

  it("depends on the timezone: the same instant is day in London and night in Hawaii", () => {
    const now = at("2026-11-16T09:00:00Z");
    expect(inQuietHours(now, "Europe/London")).toBe(false);
    expect(inQuietHours(now, "Pacific/Honolulu")).toBe(true);
    expect(sendTime(now, "Pacific/Honolulu")).toEqual(at("2026-11-16T18:00:00Z"));
  });

  it("uses Pacific time when the person has no (or an unknown) timezone", () => {
    const now = at("2026-11-16T07:00:00Z"); // 11pm Pacific
    expect(sendTime(now, null)).toEqual(at("2026-11-16T16:00:00Z"));
    expect(sendTime(now, "Mars/Olympus")).toEqual(at("2026-11-16T16:00:00Z"));
  });

  it("follows daylight saving: 8am on the morning the clocks change", () => {
    // 11pm PDT on Saturday Oct 31, 2026; clocks go back at 2am Sunday, so 8am is PST.
    expect(sendTime(at("2026-11-01T06:00:00Z"), "America/Los_Angeles")).toEqual(
      at("2026-11-01T16:00:00Z"),
    );
    // Spring forward: 11pm PST Saturday Mar 7, 2026 → 8am PDT Sunday (15:00 UTC).
    expect(sendTime(at("2026-03-08T07:00:00Z"), "America/Los_Angeles")).toEqual(
      at("2026-03-08T15:00:00Z"),
    );
  });
});
