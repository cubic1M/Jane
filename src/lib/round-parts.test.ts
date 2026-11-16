import { describe, expect, it } from "vitest";
import { wholeDollarParts, type SignedLine } from "./round-parts";

// Gate B: a sum's lines, in whole dollars, add up to its total as the tile rounds it.
const sum = (lines: SignedLine[], shown: number[]) =>
  shown.slice(0, -1).reduce((s, c, i) => s + (lines[i]!.sign === "−" ? -c : c), 0);

describe("a sum in whole dollars", () => {
  it("adds up: the dollar left over goes to the part nearest the next one", () => {
    const lines: SignedLine[] = [
      { sign: "", cents: 112_040 },
      { sign: "−", cents: 30_560 },
      { sign: "=", cents: 81_480 },
    ];
    // Each rounded alone: $1,120 − $306 = $815, a dollar out.
    const alone = lines.map((l) => Math.round(l.cents / 100) * 100);
    expect(sum(lines, alone)).not.toBe(alone.at(-1));
    const shown = wholeDollarParts(lines);
    expect(shown.at(-1)).toBe(81_500);
    expect(sum(lines, shown)).toBe(81_500);
    expect(shown).toEqual([112_000, 30_500, 81_500]);
  });

  it("keeps the total as the tile rounds it, a shortfall too", () => {
    const lines: SignedLine[] = [
      { sign: "", cents: 10_049 },
      { sign: "−", cents: 22_399 },
      { sign: "=", cents: -12_350 },
    ];
    const shown = wholeDollarParts(lines);
    expect(shown.at(-1)).toBe(-12_400);
    expect(sum(lines, shown)).toBe(shown.at(-1));
  });

  it("rounds each line alone when the lines don't add up to the total in cents", () => {
    const lines: SignedLine[] = [
      { sign: "", cents: 10_060 },
      { sign: "−", cents: 2_040 },
      { sign: "=", cents: 9_000 },
    ];
    expect(wholeDollarParts(lines)).toEqual([10_100, 2_000, 9_000]);
    expect(
      wholeDollarParts([
        { sign: "", cents: 150, unknown: true },
        { sign: "=", cents: 150 },
      ]),
    ).toEqual([200, 200]);
  });
});
