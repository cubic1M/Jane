import { describe, expect, it } from "vitest";
import { panicSells, panicSummary, type Bar } from "./panic-sells";

const bars = (list: [string, number][]): Bar[] =>
  list.map(([date, closeCents]) => ({ date, closeCents }));
// A fall from 100 to 70 in March, a recovery to 120 by October.
const VTI = bars([
  ["2026-01-02", 10_000],
  ["2026-02-02", 10_000],
  ["2026-03-10", 7_000],
  ["2026-06-01", 9_000],
  ["2026-10-20", 12_000],
]);

describe("selling after a big drop", () => {
  it("finds a sale after a fall and says what holding would have added, in dollars", () => {
    const r = panicSells([{ ticker: "VTI", date: "2026-03-10", quantity: 40, priceCents: 7_000 }], {
      VTI,
    });
    expect(r.sales).toHaveLength(1);
    expect(r.sales[0]).toMatchObject({
      soldForCents: 280_000,
      worthTodayCents: 480_000,
      costCents: 200_000,
    });
    expect(r.sales[0].dropShare).toBeCloseTo(0.3, 5);
    expect(r.sales[0].sentence).toMatch(
      /you sold 40 shares of VTI for \$2,800\.00, after it had fallen 30% from its high/,
    );
    expect(r.sales[0].sentence).toMatch(
      /worth \$4,800\.00, \$2,000\.00 more than you sold them for/,
    );
    expect(r.costCents).toBe(200_000);
  });

  it("ignores a sale that wasn't after a big drop, a tiny one and one with no price history", () => {
    const calm = panicSells(
      [{ ticker: "VTI", date: "2026-02-02", quantity: 10, priceCents: 10_000 }],
      { VTI },
    );
    expect(calm.sales).toEqual([]);
    expect(
      panicSells([{ ticker: "VTI", date: "2026-03-10", quantity: 0.1, priceCents: 7_000 }], { VTI })
        .sales,
    ).toEqual([]);
    expect(
      panicSells([{ ticker: "XYZ", date: "2026-03-10", quantity: 40, priceCents: 7_000 }], { VTI })
        .sales,
    ).toEqual([]);
  });

  it("says when selling came out ahead, and keeps both sides apart in the total", () => {
    const FALLEN = bars([
      ["2026-01-02", 10_000],
      ["2026-03-10", 8_000],
      ["2026-10-20", 4_000],
    ]);
    const r = panicSells(
      [
        { ticker: "VTI", date: "2026-03-10", quantity: 10, priceCents: 7_000 },
        { ticker: "FALL", date: "2026-03-10", quantity: 10, priceCents: 8_000 },
      ],
      { VTI, FALL: FALLEN },
    );
    const fall = r.sales.find((s) => s.ticker === "FALL")!;
    expect(fall.costCents).toBe(-40_000);
    expect(fall.sentence).toMatch(/\$400\.00 less than you sold them for/);
    expect(r.avoidedCents).toBe(40_000);
    expect(r.costCents).toBe(50_000);
  });

  it("never predicts: the summary looks back and says so", () => {
    const r = panicSells([{ ticker: "VTI", date: "2026-03-10", quantity: 40, priceCents: 7_000 }], {
      VTI,
    });
    const text = panicSummary(r)!;
    expect(text).toMatch(/holding would have left you \$2,000\.00 better off on one sale/);
    expect(text).toMatch(/says nothing about what prices do next/);
    expect(text).not.toMatch(/\b(will|should|expect|forecast)\b/i);
    expect(panicSummary({ sales: [], costCents: 0, avoidedCents: 0 })).toBeNull();
  });
});
