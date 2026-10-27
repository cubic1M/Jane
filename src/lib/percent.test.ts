import { describe, expect, it } from "vitest";
import { formatPercent, formatPercentTenths } from "./percent";

describe("formatPercent", () => {
  it("shows a share as a whole percent, rounded", () => {
    expect(formatPercent(0.25)).toBe("25%");
    expect(formatPercent(0.124)).toBe("12%");
    expect(formatPercent(0.125)).toBe("13%");
    expect(formatPercent(1.5)).toBe("150%");
    expect(formatPercent(0)).toBe("0%");
  });
});

describe("formatPercentTenths", () => {
  it("shows a share to one decimal, leaving off a .0", () => {
    expect(formatPercentTenths(0.125)).toBe("12.5%");
    expect(formatPercentTenths(0.07)).toBe("7%");
    expect(formatPercentTenths(-0.0333)).toBe("-3.3%");
  });
});
