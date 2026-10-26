import { describe, expect, it } from "vitest";
import { reportState } from "./state";

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
