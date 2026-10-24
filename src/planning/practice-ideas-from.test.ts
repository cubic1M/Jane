import { describe, expect, it } from "vitest";
import { PRACTICE_STOCKS, PRACTICE_START_CENTS, PRACTICE_UNIVERSE } from "@/config/portfolios";
import { sampleBars, sampleNews } from "@/lib/market/sample";
import { ideasFrom } from "./practice-ideas-from";
import { DEFAULT_PREFERENCES } from "./practice-preferences";
import { replayRules } from "./rule-replay";

// The ideas a replay leaves waiting, read as the practice page reads the live scan's: a change
// to suggest-only part-way stops the trades from that day and keeps them as suggestions, the
// last week's only, newest first.

const bars = Object.fromEntries(
  [...PRACTICE_UNIVERSE].map((t) => [t, sampleBars(t, "2026-04-01", "2026-10-16")]),
);
const replay = (suggestFrom?: string) =>
  replayRules({
    level: 2,
    bars,
    from: "2026-09-07",
    headlines: sampleNews(PRACTICE_STOCKS, "2026-04-01", "2026-10-16"),
    startCents: PRACTICE_START_CENTS,
    monthlyAddCents: DEFAULT_PREFERENCES.monthlyAddCents,
    addDay: DEFAULT_PREFERENCES.addDay,
    strategy: "rules",
    rules: "live",
    preferences: DEFAULT_PREFERENCES,
    changes: suggestFrom
      ? [{ from: suggestFrom, preferences: { ...DEFAULT_PREFERENCES, mode: "suggest" } }]
      : [],
    tradeCostBps: 0,
  })!;

describe("ideasFrom", () => {
  it("keeps this autumn's dip as suggestions once the person asks first", () => {
    const acting = replay();
    expect(acting.acted.tax_loss_harvest).toBeGreaterThan(0);
    const asking = replay("2026-09-17");
    expect(asking.acted.tax_loss_harvest ?? 0).toBe(0);
    expect(asking.trades.every((t) => t.date < "2026-09-17")).toBe(true);
    const ideas = ideasFrom(asking.suggestions, "2026-10-17");
    expect(ideas.map((i) => i.kind)).toEqual(
      expect.arrayContaining(["tax_loss_harvest", "dip_buy"]),
    );
    for (const i of ideas) {
      expect(i.scannedAt >= "2026-10-10").toBe(true);
      expect(i.confidence.percent).toBeGreaterThan(0);
      expect(i.headline.length).toBeGreaterThan(0);
    }
    const dates = ideas.map((i) => i.scannedAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("leaves out what is older than a week", () => {
    const asking = replay("2026-09-17");
    expect(ideasFrom(asking.suggestions, "2026-11-30")).toEqual([]);
  });
});
