import { describe, expect, it } from "vitest";
import { formatPercent } from "./percent";

describe("formatPercent", () => {
  it("shows a share as a whole percent, rounded", () => {
    expect(formatPercent(0.25)).toBe("25%");
    expect(formatPercent(0.124)).toBe("12%");
    expect(formatPercent(0.125)).toBe("13%");
    expect(formatPercent(1.5)).toBe("150%");
    expect(formatPercent(0)).toBe("0%");
  });
});
