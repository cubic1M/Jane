import { describe, expect, it } from "vitest";
import { axisDollars, axisTicks } from "./axis";

describe("the month chart's axis", () => {
  it("rounds the top up to three or four even steps", () => {
    expect(axisTicks(612_345)).toEqual([0, 250_000, 500_000, 750_000]);
    expect(axisTicks(300_000)).toEqual([0, 100_000, 200_000, 300_000]);
    expect(axisTicks(4_99)).toEqual([0, 200, 400, 600]);
    expect(axisTicks(0)).toEqual([0]);
  });

  it("covers the biggest bar", () => {
    for (const max of [1, 99, 1_234, 87_654, 1_000_001, 98_765_432]) {
      const ticks = axisTicks(max);
      expect(ticks.at(-1)).toBeGreaterThanOrEqual(max);
      expect(ticks.length).toBeLessThanOrEqual(5);
    }
  });

  it("says dollars in a few characters", () => {
    expect(axisDollars(0)).toBe("$0");
    expect(axisDollars(80_000)).toBe("$800");
    expect(axisDollars(250_000)).toBe("$2.5k");
    expect(axisDollars(1_000_000)).toBe("$10k");
    expect(axisDollars(120_000_000)).toBe("$1.2M");
  });
});
