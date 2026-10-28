import { describe, expect, it } from "vitest";
import { REAL_FUND_FACTS } from "./funds";

describe("expense ratios read from filings", () => {
  it("dates each one and cites the filing on sec.gov", () => {
    const sourced = Object.entries(REAL_FUND_FACTS).filter(([, f]) => f.asOf);
    expect(sourced.length).toBeGreaterThanOrEqual(25);
    for (const [, f] of sourced) {
      expect(f.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.source).toMatch(
        /^SEC \S+ filed \d{4}-\d{2}-\d{2}.*https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\/\d{18}\/$/,
      );
    }
  });
  it("lets the filing win over the published figure (VXUS 0.05%)", () => {
    expect(REAL_FUND_FACTS.VXUS.expenseRatioBps).toBe(5);
  });
});
