import { describe, expect, it } from "vitest";
import { feeEvidence } from "./helpers";

describe("how sure Jane is of a fund's cost", () => {
  it("is surest of figures read from the filing this year, less of the published ones, least of the demo table", () => {
    const filing = { source: "Prospectus fee table", asOf: "2026-08-01" };
    expect(feeEvidence([filing], "2026-10-28")).toEqual({
      percent: 92,
      reason: "expense ratios from the funds' filings, as of 2026-08-01",
    });
    expect(feeEvidence([{ ...filing, asOf: "2024-01-01" }], "2026-10-28").percent).toBe(80);
    expect(
      feeEvidence([{ source: "Fund company's published expense ratio, rounded" }], "2026-10-28")
        .percent,
    ).toBe(80);
    expect(
      feeEvidence(
        [{ source: "Demo fund facts (sample data, not a real fund)" }, filing],
        "2026-10-28",
      ).percent,
    ).toBe(70);
  });
  it("takes the oldest figure when several are dated", () => {
    expect(
      feeEvidence(
        [
          { source: "x", asOf: "2026-09-01" },
          { source: "x", asOf: "2025-01-01" },
        ],
        "2026-10-28",
      ).percent,
    ).toBe(80);
  });
});
