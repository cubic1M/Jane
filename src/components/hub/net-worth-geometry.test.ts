import { describe, expect, it } from "vitest";
import {
  FOCUS_MIN_DAYS,
  MIN_SPAN_CENTS,
  PAD_Y,
  chartScale,
  bigSteps,
  fitControlWords,
  fitScale,
  linePath,
  sideLabels,
  stepWords,
} from "./net-worth-geometry";

// The net worth chart's maths, as the chart drew it before it moved here.

describe("the chart's scale", () => {
  it("fits the values shown into the height, inside the padding", () => {
    const s = chartScale([100_000, 300_000, 200_000], 300, 200);
    expect([s.bottom, s.top]).toEqual([100_000, 300_000]);
    expect(s.lo).toBe(100_000);
    expect(s.hi).toBe(300_000);
    expect(s.y(300_000)).toBe(PAD_Y);
    expect(s.y(100_000)).toBe(200 - PAD_Y);
    expect(s.y(200_000)).toBe(100);
  });

  it("spreads the days across the width", () => {
    const s = chartScale([1, 2, 3, 4, 5], 400, 200);
    expect([0, 1, 4].map(s.x)).toEqual([0, 100, 400]);
  });

  it("puts a single day at the right edge", () => {
    expect(chartScale([500_000], 320, 190).x(0)).toBe(320);
  });

  it("keeps a tiny move from looking like a cliff: at least 0.1% of the top", () => {
    const s = chartScale([1_000_000, 1_000_500], 300, 200);
    expect(s.hi - s.lo).toBe(1_000.5);
    expect(s.lo + s.hi).toBe(2_000_500);
  });

  it("and at least $5 when the values are flat or small", () => {
    const flat = chartScale([2_000, 2_000], 300, 200);
    expect([flat.lo, flat.hi]).toEqual([1_750, 2_250]);
    expect(flat.y(2_000)).toBe(100);
    const none = chartScale([], 300, 200);
    expect([none.bottom, none.top]).toEqual([0, 0]);
    expect([none.lo, none.hi]).toEqual([-250, 250]);
  });

  it("works below zero", () => {
    const s = chartScale([-50_000, 50_000], 100, 128);
    expect([s.lo, s.hi]).toEqual([-50_000, 50_000]);
    expect(s.y(0)).toBe(64);
  });
});

describe("the line", () => {
  it("joins every day when there's a pixel for each", () => {
    const values = [10_000, 30_000, 20_000];
    expect(linePath(values, chartScale(values, 200, 128), 200)).toBe(
      "M0.0,114.0 L100.0,14.0 L200.0,64.0",
    );
  });

  it("keeps one vertex per pixel, and always the last day", () => {
    const values = Array.from({ length: 10 }, (_, i) => i * 10_000);
    const path = linePath(values, chartScale(values, 3, 128), 3);
    // 10 days over 3 pixels: every 3rd day, then the last.
    expect(path.split(" ").map((p) => p.split(",")[0].slice(1))).toEqual([
      "0.0",
      "1.0",
      "2.0",
      "3.0",
    ]);
    expect(path.split(" ")).toHaveLength(4);
  });

  it("is empty with no days", () => {
    expect(linePath([], chartScale([], 300, 200), 300)).toBe("");
  });
});

// The net worth chart's vertical scale (founder: "when i zoom in on the graph, because of a big change in
// my networth, it affects how the rest of my networth look likes … it's just a flat line for
// smaller number changes").

const HEIGHT = 260;
const WIDTH = 600;
const PLOT = HEIGHT - PAD_Y * 2;

// How much of the plot's height the line takes, 0 to 1.
const share = (values: readonly number[], focus?: boolean) => {
  const scale = chartScale(values, WIDTH, HEIGHT, { focus });
  const ys = values.map((v) => scale.y(v));
  return (Math.max(...ys) - Math.min(...ys)) / PLOT;
};

// Small day-to-day moves (±$20 to $300) around a level, from a fixed sequence.
const SMALL = [5_000, -12_000, 8_000, -3_000, 20_000, -9_000, 4_000, -15_000, 11_000, -2_500];
const walk = (from: number, days: number, moves = SMALL) => {
  const out: number[] = [];
  let v = from;
  for (let i = 0; i < days; i++) {
    v += moves[i % moves.length];
    out.push(v);
  }
  return out;
};

describe("the vertical scale fits the days in view", () => {
  it("runs from the lowest day to the highest when they span more than the floor", () => {
    const values = [100_000, 100_000, 100_000, 190_000];
    const s = chartScale(values, WIDTH, HEIGHT);
    expect(s.top).toBe(190_000);
    expect(s.bottom).toBe(100_000);
    expect(s.hi - s.lo).toBe(90_000);
    expect(s.y(190_000)).toBe(PAD_Y);
    expect(s.y(100_000)).toBe(HEIGHT - PAD_Y);
  });

  it("is a different scale for different days: nothing is held over from the whole history", () => {
    const history = [...walk(600_000, 30), ...walk(1_112_000, 30)];
    const week = history.slice(-7);
    const a = chartScale(history, WIDTH, HEIGHT, { focus: false });
    const b = chartScale(week, WIDTH, HEIGHT, { focus: false });
    expect(b.hi - b.lo).toBeLessThan((a.hi - a.lo) / 10);
    expect(b.top).toBe(Math.max(...week));
    expect(b.bottom).toBe(Math.min(...week));
  });

  it("has an empty scale for no days", () => {
    const s = chartScale([], WIDTH, HEIGHT);
    expect([s.top, s.bottom]).toEqual([0, 0]);
    expect(s.hi - s.lo).toBe(MIN_SPAN_CENTS);
  });
});

describe("the floor follows the moves in view", () => {
  it("keeps a flat week flat (no cliff), centred, at the $5 floor", () => {
    const flat = Array(7).fill(30_000);
    const s = chartScale(flat, WIDTH, HEIGHT);
    expect(s.hi - s.lo).toBe(MIN_SPAN_CENTS);
    expect(s.y(30_000)).toBeCloseTo(HEIGHT / 2, 5);
  });

  it("does not blow a $2 move on $300 up into a cliff", () => {
    const values = [30_000, 30_000, 30_000, 30_000, 30_000, 30_200];
    const s = share(values);
    expect(s).toBeLessThanOrEqual(0.5);
    expect(s).toBeGreaterThan(0.3);
  });

  it("shows a week of $50 moves on $160,000 as a line with shape, not 1% of the balance", () => {
    // $50 up, $50 down, … : the old floor (1% of $160,000 = $1,600) drew this 3% of the height.
    const week = [0, 5_000, 0, 5_000, 0, 5_000, 0].map((d) => 16_000_000 + d);
    expect(share(week)).toBeGreaterThanOrEqual(0.2);
    const s = chartScale(week, WIDTH, HEIGHT);
    expect(s.hi - s.lo).toBeLessThan(160_000);
  });

  it("is never under $5, however small the moves", () => {
    const tiny = [10_000, 10_001, 10_000, 10_001, 10_000];
    const s = chartScale(tiny, WIDTH, HEIGHT);
    expect(s.hi - s.lo).toBeGreaterThanOrEqual(MIN_SPAN_CENTS);
  });

  it("does not let the days' real range be cut off by the floor", () => {
    const values = [0, 400_000, 100_000, 300_000];
    const s = chartScale(values, WIDTH, HEIGHT);
    expect(s.hi).toBeGreaterThanOrEqual(400_000);
    expect(s.lo).toBeLessThanOrEqual(0);
  });
});

describe("big steps taken out of the scale", () => {
  const before = walk(600_000, 10);
  const after = walk(before[before.length - 1] + 512_000, 25);
  const rise = [...before, ...after];
  // The days' heights on the scale (a day's value less what the steps taken out moved it).
  const plotted = (values: readonly number[], focus = true) => {
    const s = chartScale(values, WIDTH, HEIGHT, { focus });
    return { s, ys: values.map((v, i) => s.y(v - s.offsets[i])) };
  };
  const spanOf = (ys: readonly number[]) => (Math.max(...ys) - Math.min(...ys)) / PLOT;

  it("finds the step: a day-to-day change of most of the range", () => {
    const [step, ...others] = bigSteps(rise);
    expect(others).toEqual([]);
    expect(step.index).toBe(10);
    expect(step.cents).toBeGreaterThan(500_000);
  });

  it("keeps both sides: each fills a third or more of the height, none runs off the chart", () => {
    const { s, ys } = plotted(rise);
    expect(s.focused).toBe(true);
    expect(spanOf(ys.slice(0, 10))).toBeGreaterThanOrEqual(0.33);
    expect(spanOf(ys.slice(10))).toBeGreaterThanOrEqual(0.33);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(HEIGHT);
    // With the step in, the same small moves took a few percent (the founder's flat line).
    const flat = plotted(rise, false);
    expect(flat.s.focused).toBe(false);
    expect(spanOf(flat.ys.slice(10))).toBeLessThan(0.1);
  });

  it("shifts the days after the step by its amount, and today stays on the chart", () => {
    const s = chartScale(rise, WIDTH, HEIGHT);
    const [step] = s.breaks;
    expect(s.offsets.slice(0, 10).every((o) => o === 0)).toBe(true);
    expect(s.offsets.slice(10).every((o) => o === step.cents)).toBe(true);
    const todayY = s.y(rise[rise.length - 1] - s.offsets[rise.length - 1]);
    expect(todayY).toBeGreaterThanOrEqual(0);
    expect(todayY).toBeLessThanOrEqual(HEIGHT);
  });

  it("labels each side with its own true values", () => {
    const s = fitScale(rise, { focus: true });
    const labels = sideLabels(s);
    // Left edge: the days before the step, true.
    expect(labels.left.high).toBe(s.top);
    expect(labels.left.low).toBe(s.bottom);
    // Right edge: the same heights, true for the days after the step.
    expect(labels.right).toEqual({
      high: s.top + s.breaks[0].cents,
      low: s.bottom + s.breaks[0].cents,
    });
    // A day after the step at the top of the scale reads as that label.
    const top = Math.max(...after.map((v) => v - s.breaks[0].cents));
    expect(top).toBeLessThanOrEqual(s.top);
    expect(sideLabels(fitScale(rise, { focus: false })).right).toBeNull();
  });

  it("steps down as well as up", () => {
    const long = walk(1_112_000, 20);
    const drop = [...long, ...walk(long[long.length - 1] - 512_000, 12)];
    const [step] = bigSteps(drop);
    expect(step.index).toBe(20);
    expect(step.cents).toBeLessThan(-500_000);
  });

  it("takes out two steps, the largest first", () => {
    const a = walk(600_000, 12);
    const b = walk(a[a.length - 1] + 400_000, 12);
    const c = walk(b[b.length - 1] + 1_100_000, 12);
    const steps = bigSteps([...a, ...b, ...c]);
    expect(steps.map((x) => x.index)).toEqual([24, 12]);
    const s = chartScale([...a, ...b, ...c], WIDTH, HEIGHT);
    expect(s.offsets[30]).toBeGreaterThan(1_400_000);
    const ys = [...a, ...b, ...c].map((v, i) => s.y(v - s.offsets[i]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  });

  it("falls back to fit all with a fourth big step", () => {
    let level = 600_000;
    const days: number[] = [];
    for (let k = 0; k < 5; k++) {
      days.push(...walk(level, 10));
      level += 300_000 * 3 ** k;
    }
    expect(bigSteps(days)).toEqual([]);
    const fit = fitScale(days, { focus: true });
    expect(fit.focused).toBe(false);
    expect(fit.offsets.every((o) => o === 0)).toBe(true);
    // Three steps are still taken out.
    expect(bigSteps(days.slice(0, 40)).length).toBe(3);
  });

  it("is not a step with fewer than a handful of days", () => {
    const short = [...walk(600_000, FOCUS_MIN_DAYS - 3), ...walk(1_200_000, 2)];
    expect(bigSteps(short)).toEqual([]);
  });

  it("is not a step when no one change takes most of the height", () => {
    const stairs = Array.from({ length: 30 }, (_, i) => 600_000 + i * 40_000);
    expect(bigSteps(stairs)).toEqual([]);
    expect(bigSteps(walk(600_000, 40))).toEqual([]);
  });

  it("is not a step when taking it out would show the rest no taller (a $2 jump on $300)", () => {
    expect(bigSteps([...Array(8).fill(30_000), ...Array(8).fill(30_200)])).toEqual([]);
  });

  it("is not a step when nothing else moves (a flat balance, then a paycheck)", () => {
    const flatThenPay = [...Array(20).fill(-50_000), ...Array(6).fill(150_000)];
    expect(bigSteps(flatThenPay)).toEqual([]);
    expect(fitScale(flatThenPay, { focus: true }).focused).toBe(false);
  });

  it("is not there with no days or flat days", () => {
    expect(bigSteps([])).toEqual([]);
    expect(bigSteps(Array(20).fill(5_000))).toEqual([]);
  });

  it("leaves the whole range fitted when not focused (Fit all)", () => {
    const all = fitScale(rise, { focus: false });
    expect(all.breaks).toHaveLength(1);
    expect(all.top).toBe(Math.max(...rise));
    expect(all.bottom).toBe(Math.min(...rise));
    expect(fitControlWords(true)).toBe("Fit all");
    expect(fitControlWords(false)).toBe("Focus");
  });

  it("starts a new piece of the line at each break, so there is a gap", () => {
    const s = chartScale(rise, WIDTH, HEIGHT);
    const path = linePath(rise, s, WIDTH);
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path.split("L").length).toBe(rise.length - 1);
    // The line before and after the break sit at about the same height.
    const pieces = path.split(" M");
    const lastLeft = Number(pieces[0].split(" ").at(-1)!.split(",")[1]);
    const firstRight = Number(pieces[1].split(" ")[0].split(",")[1]);
    expect(Math.abs(lastLeft - firstRight)).toBeLessThan(PLOT / 3);
  });
});

describe("what the marker says", () => {
  it("names the figure and the day", () => {
    expect(stepWords({ cents: 512_000 }, "Nov 3", true)).toBe("+$5,120 on Nov 3");
    expect(stepWords({ cents: -512_000 }, "Nov 3", true)).toBe("−$5,120 on Nov 3");
  });

  it("gives no figure while the figures are hidden", () => {
    const hidden = stepWords({ cents: 512_000 }, "Nov 3", false);
    expect(hidden).toBe("A big rise on Nov 3");
    expect(hidden).not.toMatch(/\d{2}|\$/);
    expect(stepWords({ cents: -512_000 }, "Nov 3", false)).toBe("A big drop on Nov 3");
  });
});
