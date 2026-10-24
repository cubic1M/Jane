import { describe, expect, it } from "vitest";
import { sessionsOf } from "@/planning/intraday";
import { sampleBars } from "./sample";
import { sampleSession } from "./sample-intraday";

// The sample market's 5-minute bars: one whole New York session a trading day, ending at the
// day's own close, the same every time.

describe("sampleSession", () => {
  it("is one whole session that ends at the day's close, in winter and in summer", () => {
    for (const day of ["2026-01-14", "2026-07-15"]) {
      const bars = sampleSession("SPY", day);
      const [s] = sessionsOf(bars);
      expect(s.date).toBe(day);
      expect(s.bars).toHaveLength(78);
      expect(s.bars[0].minute).toBe(570);
      expect(s.bars.at(-1)!.c).toBe(sampleBars("SPY", day, day)[0].closeCents);
      for (const b of s.bars) {
        expect(b.h).toBeGreaterThanOrEqual(Math.max(b.o, b.c));
        expect(b.l).toBeLessThanOrEqual(Math.min(b.o, b.c));
        expect(b.v).toBeGreaterThan(0);
      }
    }
  });

  it("is the same every time, and empty on a weekend or for an unknown fund", () => {
    expect(sampleSession("SPY", "2026-10-16")).toEqual(sampleSession("SPY", "2026-10-16"));
    expect(sampleSession("SPY", "2026-10-17")).toEqual([]);
    expect(sampleSession("NOPE", "2026-10-16")).toEqual([]);
  });
});
