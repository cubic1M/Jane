import { describe, expect, it } from "vitest";
import { daysToEstimatedDate, estimatedDatesBetween } from "./taxes";

// CodeRabbit sweep 1b: January 15, 2028 is a Saturday, so the installment is due Monday the
// 17th (the 17th is also Martin Luther King Jr. Day, so Tuesday the 18th). On January 16 the
// countdown skipped it.
describe("estimated payment dates on business days", () => {
  it("counts a weekend January 15 as due the next business day", () => {
    // Jan 17, 2028 is the third Monday: MLK Day, so Tuesday the 18th.
    expect(daysToEstimatedDate("2028-01-16")).toBe(2);
    expect(estimatedDatesBetween("2028-01-16", "2028-01-18")).toBe(1);
  });
  it("leaves an ordinary weekday as it is", () => {
    // April 15, 2026 is a Wednesday.
    expect(daysToEstimatedDate("2026-04-10")).toBe(5);
  });
});
