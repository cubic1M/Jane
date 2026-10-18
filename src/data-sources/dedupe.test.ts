import { describe, expect, it } from "vitest";
import { dedupeKeys } from "./dedupe";

const COFFEE = { date: "2026-10-13", amountCents: 575, description: "BLUE BOTTLE #1" };

describe("dedupeKeys", () => {
  it("is stable for the same rows", () => {
    expect(dedupeKeys([COFFEE])).toEqual(dedupeKeys([COFFEE]));
  });

  it("ignores case and spacing in the description", () => {
    expect(dedupeKeys([{ ...COFFEE, description: "blue  bottle #1 " }])).toEqual(
      dedupeKeys([COFFEE]),
    );
  });

  it("tells identical rows in one file apart, in order", () => {
    const [first, second] = dedupeKeys([COFFEE, COFFEE]);
    expect(first).not.toBe(second);
    expect(dedupeKeys([COFFEE])[0]).toBe(first);
  });

  it("matches the shared rows of two overlapping exports", () => {
    const tea = { ...COFFEE, description: "TEA", amountCents: 300 };
    const older = dedupeKeys([tea, COFFEE]);
    const newer = dedupeKeys([COFFEE, { ...COFFEE, date: "2026-10-14" }]);
    expect(newer[0]).toBe(older[1]);
  });

  it("changes when date, amount or description changes", () => {
    const [base] = dedupeKeys([COFFEE]);
    expect(dedupeKeys([{ ...COFFEE, date: "2026-10-14" }])[0]).not.toBe(base);
    expect(dedupeKeys([{ ...COFFEE, amountCents: 576 }])[0]).not.toBe(base);
    expect(dedupeKeys([{ ...COFFEE, description: "BLUE BOTTLE #2" }])[0]).not.toBe(base);
  });
});
