import { describe, expect, it } from "vitest";
import { TIMEZONES } from "@/config/digest";
import { inReportWindow } from "./window";

// The daily report goes out from 7am to 8pm on the person's own clock: its own window, not the chat's
// quiet hours. The cron that sends it (/api/cron/digest) runs once a day, at 15:00 UTC today
// (vercel.json); this says who that run reaches (docs/daily-report.md).

const at = (iso: string) => new Date(iso);
const RUN = (day: string) => at(`${day}T15:00:00Z`);

describe("inReportWindow", () => {
  it("is 7am up to 8pm, local time", () => {
    // Los Angeles in winter is UTC-8.
    expect(inReportWindow(at("2027-01-13T14:59:00Z"), "America/Los_Angeles")).toBe(false);
    expect(inReportWindow(at("2027-01-13T15:00:00Z"), "America/Los_Angeles")).toBe(true);
    expect(inReportWindow(at("2027-01-14T03:59:00Z"), "America/Los_Angeles")).toBe(true);
    expect(inReportWindow(at("2027-01-14T04:00:00Z"), "America/Los_Angeles")).toBe(false);
  });

  it("gives a person in Los Angeles in winter the report from the 15:00 UTC run", () => {
    expect(inReportWindow(RUN("2027-01-13"), "America/Los_Angeles")).toBe(true);
    // Someone who never picked a timezone is on Pacific time.
    expect(inReportWindow(RUN("2027-01-13"), null)).toBe(true);
  });

  // Who the 15:00 UTC run does not reach, by timezone offered on /settings, on standard and daylight
  // time: Hawaii all year (5am) and Alaska in winter (6am). The PR says so.
  it("says who the 15:00 UTC run does not reach", () => {
    const outside = (day: string) =>
      TIMEZONES.filter((t) => !inReportWindow(RUN(day), t.id)).map((t) => t.id);
    expect(outside("2027-01-13")).toEqual(["America/Anchorage", "Pacific/Honolulu"]);
    expect(outside("2027-07-14")).toEqual(["Pacific/Honolulu"]);
  });
});
