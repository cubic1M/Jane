import { describe, expect, it } from "vitest";
import { reportState, shortUploadDays } from "./state";

const base = { transactions: 240, findings: 0, firstDetectionDone: true, scanRunning: false };

describe("reportState", () => {
  it("asks for an account when nothing has been read and nothing is being read", () => {
    expect(reportState({ ...base, transactions: 0 })).toBe("no_data");
  });

  // Messy-bank QA: never an empty list, or "nothing found", while the first scan runs.
  it("says Jane is still reading while the first scan runs, found or not", () => {
    expect(reportState({ ...base, firstDetectionDone: false })).toBe("scanning");
    expect(reportState({ ...base, findings: 3, firstDetectionDone: false })).toBe("scanning");
    expect(reportState({ ...base, scanRunning: true, findings: 2 })).toBe("scanning");
    expect(reportState({ ...base, transactions: 0, scanRunning: true })).toBe("scanning");
  });

  it("shows the findings, or what was checked, once the scan is done", () => {
    expect(reportState({ ...base, findings: 4 })).toBe("found");
    expect(reportState(base)).toBe("nothing");
  });
});

describe("shortUploadDays", () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it("counts the days uploaded statements cover when it's under three months", () => {
    expect(shortUploadDays(day("2026-09-01"), day("2026-09-30"))).toBe(30);
  });

  it("is null with enough months, or nothing uploaded", () => {
    expect(shortUploadDays(day("2026-07-01"), day("2026-09-30"))).toBeNull();
    expect(shortUploadDays(null, null)).toBeNull();
  });
});
