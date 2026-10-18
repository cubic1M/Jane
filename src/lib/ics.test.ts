import { describe, expect, it } from "vitest";
import { buildCalendar, escapeText, foldLine } from "./ics";

describe("iCalendar writing", () => {
  it("escapes text values", () => {
    expect(escapeText("Rent; due, now\\later\nok")).toBe("Rent\; due\\, now\\\\later\\nok");
  });

  it("folds lines over 75 octets, counting multi-byte characters", () => {
    const folded = foldLine(`SUMMARY:${"é".repeat(60)}`);
    for (const line of folded.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replaceAll("\r\n ", "")).toBe(`SUMMARY:${"é".repeat(60)}`);
    expect(foldLine("SHORT")).toBe("SHORT");
  });

  it("writes all-day events with CRLF line endings", () => {
    const ics = buildCalendar(
      "Money calendar",
      [{ uid: "bill-netflix-2026-10-20@x", date: "2026-10-20", summary: "Netflix, about $15.49" }],
      new Date("2026-10-15T12:34:56Z"),
    );
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics).toContain("UID:bill-netflix-2026-10-20@x\r\n");
    expect(ics).toContain("DTSTAMP:20261015T123456Z\r\n");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261021\r\n");
    expect(ics).toContain("SUMMARY:Netflix\\, about $15.49\r\n");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
