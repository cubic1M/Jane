import { describe, expect, it } from "vitest";
import { formatWholeDollars } from "@/lib/money";
import {
  STEP_LABEL_H,
  placeStepLabels,
  scaleLabelBoxes,
  stepLabelWidth,
  stepWords,
  type Box,
} from "./net-worth-geometry";

// Where a break's label goes (a walk of main: a step in the last days printed "+$8,960 on Nov 25"
// over the corner figure, so "$17,522" read ",522").

const HEIGHT = 200;
const DAYS = 150;
const dollars = formatWholeDollars;
// The scale as a chart with a step taken out draws it: highs at the top corners, lows at the
// bottom corners (the left pair true before the step, the right pair after it).
const y = (cents: number) => 14 + (1 - (cents - 800_000) / 1_000_000) * (HEIGHT - 28);
const LEFT = { high: 1_752_200, low: 842_300 };
const RIGHT = { high: 1_752_200 + 539_700, low: 842_300 + 539_700 };

const corners = (width: number, amounts = true) =>
  scaleLabelBoxes({ width, height: HEIGHT, y, left: LEFT, right: RIGHT, amounts, text: dollars });

// A step landing on day `index` of DAYS: the break sits between that day and the one before.
const atDay = (index: number, width: number) =>
  (((index - 1 + index) / 2 / (DAYS - 1)) * width) | 0;
const words = (shown = true) => stepWords({ cents: 539_700 }, "Sep 28", shown);

const inside = (b: Box, width: number) =>
  b.left >= 0 && b.top >= 0 && b.left + b.width <= width && b.top + b.height <= HEIGHT;
const touch = (a: Box, b: Box) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

function place(steps: number[], width: number, shown = true) {
  const texts = steps.map(() => words(shown));
  const places = placeStepLabels({
    at: steps.map((s) => atDay(s, width)),
    widths: texts.map(stepLabelWidth),
    width,
    height: HEIGHT,
    corners: corners(width, shown),
  });
  // Every label inside the chart, off every scale label and off every other label.
  places.forEach((p, i) => {
    expect(inside(p.box, width)).toBe(true);
    for (const c of corners(width, shown)) expect(touch(p.box, c)).toBe(false);
    places.slice(i + 1).forEach((q) => expect(touch(p.box, q.box)).toBe(false));
  });
  return places;
}

describe("a break's label", () => {
  it("keeps its look for a step in the middle: beside the break, on the top line", () => {
    const [p] = place([75], 700);
    expect(p.y).toBe(0);
    expect(p.anchor).toBe("start");
    expect(p.box.left).toBe(atDay(75, 700) + 6);
    const [late] = place([100], 700);
    expect(late.anchor).toBe("end");
    expect(late.y).toBe(0);
  });

  for (const width of [700, 375]) {
    for (const days of [1, 2, 3]) {
      it(`${days} day(s) from the right edge at ${width}px: clear of every scale label`, () => {
        const [p] = place([DAYS - days], width);
        expect(p.box.left + p.box.width).toBeLessThanOrEqual(width);
      });
      it(`${days} day(s) from the left edge at ${width}px: clear of every scale label`, () => {
        const [p] = place([days + 1], width);
        expect(p.box.left).toBeGreaterThanOrEqual(0);
      });
    }
  }

  it("drops a line below the corner figure when the step is at the edge", () => {
    const [p] = place([DAYS - 2], 700);
    expect(p.y).toBeGreaterThanOrEqual(STEP_LABEL_H);
  });

  it("stacks two breaks close together, never over each other", () => {
    for (const width of [700, 375]) {
      const [a, b] = place([DAYS - 5, DAYS - 3], width);
      expect(a.y).not.toBe(b.y);
      place([60, 62], width);
      place([2, 4], width);
    }
  });

  it("fits three breaks together and with the figures hidden (the longer words)", () => {
    for (const width of [700, 375]) {
      place([DAYS - 2, DAYS - 3, 3], width);
      place([DAYS - 1], width, false);
      place([2], width, false);
      place([75], width, false);
      place([DAYS - 4, DAYS - 2], width, false);
    }
  });

  it("anchors by the edge it sits on, and says where", () => {
    const [p] = place([DAYS - 1], 375);
    expect(p.x).toBe(p.anchor === "start" ? p.box.left : p.box.left + p.box.width);
  });

  it("with no room anywhere, still stays inside the chart's width", () => {
    const [p] = placeStepLabels({
      at: [10],
      widths: [stepLabelWidth(words())],
      width: 90,
      height: 40,
      corners: [{ left: 0, top: 0, width: 90, height: 40 }],
    });
    expect(p.box.left).toBeGreaterThanOrEqual(0);
    expect(p.box.top).toBeGreaterThanOrEqual(0);
  });
});

describe("the scale labels' boxes", () => {
  it("are none while the figures are hidden", () => {
    expect(corners(700, false)).toEqual([]);
  });
  it("hold the two left and the two right figures", () => {
    expect(corners(700)).toHaveLength(4);
  });
});
