import { describe, expect, it } from "vitest";
import type { NetWorthEvent } from "@/insights/net-worth-events";
import { placeBoxes, summaryLine, transactionsHref } from "./net-worth-chart";

// A net worth day's boxes (founder: "each dot should have an expandable box that shows exactly
// where that money went … another box next to it connected by dotted animated line … all in the
// net worth graph area, not covering up anything else").

const inside = (r: { left: number; top: number; width: number }, width: number) =>
  r.left >= 0 && r.top >= 0 && r.left + r.width <= width;

describe("a day's summary line", () => {
  it("says what it did, what it was and where, briefly", () => {
    const payment: NetWorthEvent = {
      date: "2026-09-26",
      kind: "card_payment",
      label: "Card payment: Chase",
      cents: 0,
      moved: 164_000,
      href: "/transactions?q=Chase",
      name: "Chase",
      account: "Demo Checking ····0000",
    };
    expect(summaryLine(payment)).toBe("$1,640 moved · card payment · Demo Checking ····0000");
    expect(
      summaryLine({
        ...payment,
        kind: "purchase",
        cents: -164_000,
        moved: undefined,
        account: undefined,
      }),
    ).toBe("−$1,640 · purchase · Chase");
  });
});

describe("where a day's boxes go", () => {
  const wide = 760;
  const narrow = 320;
  const height = 260;

  it("keeps the summary inside the chart at either edge, above a low dot, below a high one", () => {
    for (const x of [0, 30, wide / 2, wide - 10, wide]) {
      for (const y of [20, height - 20]) {
        const p = placeBoxes({ dot: { x, y }, width: wide, height, summary: 90, detail: null });
        expect(inside(p.summary, wide), `${x},${y}`).toBe(true);
        expect(p.summary.top < y).toBe(y > height / 2);
      }
    }
  });

  it("puts the details beside the summary, toward the middle, both inside", () => {
    for (const x of [5, 200, 560, wide - 5]) {
      const p = placeBoxes({ dot: { x, y: 200 }, width: wide, height, summary: 90, detail: 180 });
      expect(p.stacked).toBe(false);
      expect(inside(p.summary, wide), `summary at ${x}`).toBe(true);
      expect(inside(p.detail!, wide), `details at ${x}`).toBe(true);
      // Side by side, never on top of each other.
      const [l, r] =
        p.detail!.left > p.summary.left ? [p.summary, p.detail!] : [p.detail!, p.summary];
      expect(l.left + l.width).toBeLessThanOrEqual(r.left);
    }
  });

  it("stacks them on a phone, and grows the chart to hold them rather than spill over", () => {
    const p = placeBoxes({
      dot: { x: 300, y: 240 },
      width: narrow,
      height: 190,
      summary: 90,
      detail: 220,
    });
    expect(p.stacked).toBe(true);
    expect(inside(p.summary, narrow)).toBe(true);
    expect(inside(p.detail!, narrow)).toBe(true);
    expect(p.detail!.top).toBeGreaterThan(p.summary.top + p.summary.height);
    expect(p.height).toBeGreaterThanOrEqual(p.detail!.top + p.detail!.height);
    expect(p.height).toBeGreaterThan(190);
  });
});

describe("transactionsHref", () => {
  const e = (date: string) => ({ date }) as NetWorthEvent;
  it("leads to the day's transactions, or the days a dot holds", () => {
    expect(transactionsHref({ date: "2026-10-05", cents: 0, events: [e("2026-10-05")] })).toBe(
      "/transactions?day=2026-10-05",
    );
    expect(
      transactionsHref({
        date: "2026-10-03",
        cents: 0,
        events: [e("2026-10-03"), e("2026-10-05"), e("2026-10-04")],
      }),
    ).toBe("/transactions?from=2026-10-03&to=2026-10-05");
  });
});
