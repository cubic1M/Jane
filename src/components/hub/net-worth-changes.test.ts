import { describe, expect, it } from "vitest";
import { DAY_BARS_MAX_DAYS, WEEK_BARS_MAX_DAYS } from "@/config/net-worth-changes";
import { bucketChanges, changeScale, periodFor, squash, barLabel } from "./net-worth-changes";

// The Changes view (founder, Nov 28: "9 dollar spending and 138 looks the same because compared to
// net worth it's only a flat line"): one bar per period, on a compressed scale.

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
const series = (changes: number[], start = 2_000_000) => {
  let c = start;
  return [start, ...changes].map((v, i) => ({ date: day(i), cents: i === 0 ? c : (c += v) }));
};

describe("periodFor", () => {
  it("picks day, week and month by the days on screen", () => {
    expect(periodFor(1)).toBe("day");
    expect(periodFor(DAY_BARS_MAX_DAYS)).toBe("day");
    expect(periodFor(DAY_BARS_MAX_DAYS + 1)).toBe("week");
    expect(periodFor(WEEK_BARS_MAX_DAYS)).toBe("week");
    expect(periodFor(WEEK_BARS_MAX_DAYS + 1)).toBe("month");
  });
});

describe("bucketChanges", () => {
  const points = series([-900, 13_800, -4_500, 0, 6_000, -12_800, 100]);

  it("makes a bar of each day: its point less the one before", () => {
    const bars = bucketChanges(points, 0, 7, "day");
    expect(bars.map((b) => b.change)).toEqual([-900, 13_800, -4_500, 0, 6_000, -12_800, 100]);
    expect(bars[1].endCents).toBe(points[2].cents);
    expect(bars[1].endIndex).toBe(2);
  });

  it("gives the first day on screen the change from the day before it", () => {
    const bars = bucketChanges(points, 3, 4, "day");
    expect(bars.map((b) => b.change)).toEqual([-4_500, 0]);
  });

  it("groups a week from Monday, summing its days", () => {
    // 2026-01-01 is a Thursday: Fri to Sun is one bar, then Mon to Sun the next.
    const bars = bucketChanges(points, 0, 7, "week");
    expect(bars.map((b) => b.from)).toEqual([day(1), day(4)]);
    expect(bars[0].change).toBe(points[3].cents - points[0].cents);
    expect(bars[1].to).toBe(day(7));
    expect(bars.reduce((s, b) => s + b.change, 0)).toBe(points[7].cents - points[0].cents);
  });

  it("groups a month", () => {
    const long = series(Array.from({ length: 70 }, () => 100));
    const bars = bucketChanges(long, 0, 70, "month");
    expect(bars.map((b) => b.from.slice(0, 7))).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(bars.reduce((s, b) => s + b.change, 0)).toBe(7_000);
  });

  it("has no bars for one point or none", () => {
    expect(bucketChanges(series([]), 0, 0)).toEqual([]);
    expect(bucketChanges([], 0, 0)).toEqual([]);
  });

  it("words the periods", () => {
    const d = (x: string) => `D${x}`;
    const m = (x: string) => `M${x}`;
    const [w] = bucketChanges(points, 0, 7, "week");
    expect(barLabel(w, d, m)).toBe("Week of D2025-12-29");
    const [one] = bucketChanges(points, 0, 7, "day");
    expect(barLabel(one, d, m)).toBe(`D${day(1)}`);
    const [mo] = bucketChanges(points, 0, 7, "month");
    expect(barLabel(mo, d, m)).toBe("M2026-01");
  });
});

describe("the changes scale", () => {
  const bar = (change: number) => ({
    period: "day" as const,
    from: "2026-01-01",
    to: "2026-01-01",
    endIndex: 1,
    endCents: 0,
    change,
  });
  const height = (bars: ReturnType<typeof bar>[], cents: number, h = 260) => {
    const s = changeScale(bars, h);
    return Math.abs(s.y(cents) - s.zero);
  };
  // The founder's kind of days: -$18,000 and +$9,000 among ordinary $9 to $138 days.
  const all = [-1_800_000, 900_000, -900, 13_800, -4_500, 6_000, -12_800].map(bar);

  it("shows a $9, a $138 and an $18,000 change as clearly different heights", () => {
    const nine = height(all, 900);
    const big = height(all, 13_800);
    const huge = height(all, -1_800_000);
    expect(nine).toBeGreaterThanOrEqual(3);
    expect(big).toBeGreaterThanOrEqual(3 * nine);
    expect(huge).toBeGreaterThan(big * 3);
    // The biggest stays inside the padding at the chart's edge.
    const s = changeScale(all, 260);
    expect(s.y(-1_800_000)).toBeLessThanOrEqual(260 - 14 + 0.001);
    expect(s.y(900_000)).toBeGreaterThanOrEqual(14 - 0.001);
  });

  it("is the same size up and down, with up above zero", () => {
    const s = changeScale(all, 260);
    expect(s.y(5_000)).toBeLessThan(s.zero);
    expect(s.y(-5_000)).toBeGreaterThan(s.zero);
    expect(s.zero - s.y(5_000)).toBeCloseTo(s.y(-5_000) - s.zero, 6);
  });

  it("labels real amounts, both sides, and stops where the bars do", () => {
    expect(changeScale(all, 260).ticks).toEqual([
      100_000, 10_000, 1_000, -1_000, -10_000, -100_000, -1_000_000,
    ]);
    // A quiet stretch: $10 and $100 only.
    const quiet = changeScale([-900, 13_800, 6_000].map(bar), 260).ticks;
    expect(quiet).toEqual([10_000, 1_000]);
  });

  it("does not stretch a tiny wobble into a cliff, and keeps zero when nothing moved", () => {
    expect(height([bar(200)], 200)).toBeLessThan(70);
    const flat = changeScale([bar(0), bar(0)], 260);
    expect(flat.zero).toBeCloseTo(130, 6);
    const none = changeScale([], 260);
    expect(none.zero).toBeCloseTo(130, 6);
    expect(Number.isFinite(none.y(500))).toBe(true);
  });

  it("is one bar for a single change, all equal changes the same height", () => {
    const equal = [bar(5_000), bar(5_000)];
    expect(height(equal, 5_000)).toBeGreaterThan(50);
    expect(squash(0)).toBe(0);
    expect(squash(-5_000)).toBe(-squash(5_000));
  });
});
