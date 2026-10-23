import { describe, expect, it } from "vitest";
import { MODEL_PORTFOLIOS } from "@/config/portfolios";
import { realFixtureBars } from "@/lib/market/__fixtures__/real";
import { alignUniverse } from "./engine";
import { followToday } from "./follow";

// What the practice autopilot follows for a level's chosen strategy, on real closes: the trend
// filter's weights by practice kind, the same all month; the mix itself, a fund the ledger
// can't hold and a floor that needs the portfolio's high are not followed.

const data = alignUniverse(realFixtureBars())!;
const trend = { id: "trend" as const, params: { months: 6 } };
const sum = (w: Record<string, number>) => Object.values(w).reduce((s, x) => s + x, 0);

describe("followToday", () => {
  it("follows the trend filter: the level's mix in a rising market, bills in mid-2022", () => {
    const rising = followToday(trend, data, 2, "2019-07-15");
    expect(rising.follow).toBe(true);
    if (!rising.follow) return;
    for (const [c, w] of Object.entries(MODEL_PORTFOLIOS[2].weights))
      expect(rising.weights[c as keyof typeof rising.weights]).toBeCloseTo(w, 9);

    const falling = followToday(trend, data, 2, "2022-06-15");
    expect(falling.follow).toBe(true);
    if (!falling.follow) return;
    expect(sum(falling.weights)).toBeCloseTo(1, 9);
    // US stocks and bonds both under their 6-month averages: their shares wait in bills. (In
    // June 2021 bonds alone were under theirs: 50% in bills, the stocks kept.)
    expect(falling.weights.us_stocks).toBe(0);
    expect(falling.weights.bonds).toBe(0);
    expect(falling.weights.cash).toBeGreaterThan(0.8);
    expect(falling.signalDate).toBe("2022-06-01");
    const bondsOnly = followToday(trend, data, 2, "2021-06-15");
    expect(bondsOnly.follow && bondsOnly.weights).toMatchObject({ bonds: 0, us_stocks: 0.3 });
  });

  it("holds the month's weights all month: the signal is the month's first trading day", () => {
    const early = followToday(trend, data, 3, "2022-03-02");
    const late = followToday(trend, data, 3, "2022-03-30");
    expect(late).toEqual(early);
  });

  it("doesn't follow the mix itself, a floor, or a strategy holding funds the ledger can't", () => {
    expect(
      followToday({ id: "static", params: { rebalance: "band" } }, data, 2, "2022-06-15"),
    ).toMatchObject({ follow: false });
    expect(followToday({ id: "cppi", params: { multiplier: 3 } }, data, 2, "2022-06-15")).toEqual({
      follow: false,
      why: "A drawdown floor needs the portfolio's own high.",
    });
    const wide = followToday(
      { id: "inverse_vol", params: { windowDays: 63, scope: "sleeves" } },
      data,
      3,
      "2022-06-15",
    );
    expect(wide.follow).toBe(false);
    expect(!wide.follow && wide.why).toMatch(/practice portfolio can't yet/);
  });
});
