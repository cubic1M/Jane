import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn() }));
import { DEMO_ADVICE_LABEL } from "@/config/advice";
import type { LatestStrategies } from "@/lib/investments/strategy-eval";
import { LevelStrategiesSection } from "./level-strategies";

// "The strategy each level follows" on the investments page: the daily replay's choice per
// level with its numbers against the mix, the person's level marked, demo advice, never a forecast.

const m = (cagr: number, maxDrawdown: number, sortino: number) => ({
  from: "2022-01-03",
  to: "2026-10-16",
  cagr,
  vol: 0.08,
  maxDrawdown,
  sortino,
  turnover: 3.8,
  costShare: 0.001,
  rebalances: 57,
});
const latest = {
  ranAt: new Date("2026-10-19T11:00:00Z"),
  source: "alpaca",
  from: "2016-01-04",
  to: "2026-10-16",
  byLevel: Object.fromEntries(
    ([1, 2, 3, 4, 5] as const).map((level) => [
      level,
      {
        level,
        id: level === 5 ? "static" : "trend",
        params: {},
        key: level === 5 ? "static(rebalance=band)" : "trend(months=6)",
        label: level === 5 ? "The level's mix" : "Trend filter",
        why: `Why for ${level}.`,
        train: m(0.1, 0.1, 1.5),
        test: m(0.07, 0.084, 0.56),
        baseline: { train: m(0.12, 0.27, 1.17), test: m(0.082, 0.226, 0.49) },
      },
    ]),
  ),
} as unknown as LatestStrategies;

describe("LevelStrategiesSection", () => {
  it("shows each level's strategy, its numbers against the mix and the budget", () => {
    const html = renderToStaticMarkup(<LevelStrategiesSection latest={latest} level={4} />);
    expect(html).toContain("The strategy each level follows");
    expect(html.match(/data-level=/g)).toHaveLength(5);
    expect(html).toContain('data-strategy="trend(months=6)"');
    expect(html).toContain("High<span");
    expect(html).toContain("(your level)");
    expect(html).toContain("8.4%");
    expect(html).toContain("(mix 22.6%)");
    expect(html).toContain("drop 30.0%, volatility 14.0%");
    expect(html).toContain("Why for 4.");
    expect(html).toContain("Jan 4, 2016");
    expect(html).toContain(DEMO_ADVICE_LABEL);
    expect(html).toContain("not a forecast");
    expect(html.replaceAll("not a forecast", "")).not.toMatch(/forecast/i);
  });

  it("says every level follows its mix before the first daily replay", () => {
    const html = renderToStaticMarkup(<LevelStrategiesSection latest={null} />);
    expect(html).toMatch(/hasn(&#x27;|')t run yet, so every level follows its mix/);
    expect(html).not.toContain("data-level=");
    expect(html).toContain(DEMO_ADVICE_LABEL);
  });
});
