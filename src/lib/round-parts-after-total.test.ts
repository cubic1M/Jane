import { describe, expect, it } from "vitest";
import { wholeDollarParts, type SignedLine } from "./round-parts";

// A line after the total is what isn't counted in it (pay that didn't come in, uneven pay): the
// lines down to the total still add up in whole dollars, and the one after is rounded on its own.

describe("a line after the total", () => {
  it("leaves the sum above it adding up", () => {
    const lines: SignedLine[] = [
      { sign: "", cents: 112_040 },
      { sign: "+", cents: 165_049 },
      { sign: "−", cents: 30_560 },
      { sign: "=", cents: 246_529 },
      { sign: "", cents: 165_049 },
    ];
    const shown = wholeDollarParts(lines);
    expect(shown).toEqual([112_000, 165_100, 30_600, 246_500, 165_000]);
    expect(shown[0]! + shown[1]! - shown[2]!).toBe(shown[3]);
  });
});
