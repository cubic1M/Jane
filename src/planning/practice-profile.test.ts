import { describe, expect, it } from "vitest";
import {
  AUTOPILOT_LIMITS,
  PRACTICE_ETFS,
  PRACTICE_STOCKS,
  type PracticeClass,
} from "@/config/portfolios";
import {
  APPETITE_ORDER,
  LEVEL_WORST_DROP_PERCENT,
  OPPORTUNITY_HARD_CAPS,
  OPPORTUNITY_HARD_MAX_SHARE,
  OPPORTUNITY_MIN_APPETITE,
} from "@/config/practice-preferences";
import { SCAN_CAPS, SCAN_KINDS } from "@/config/practice-scan";
import { DEFAULT_PREFERENCES, type PracticePreferences } from "./practice-preferences";
import {
  avoidedTickers,
  glideWeights,
  levelForDrop,
  profileFor,
  refusedByPreferences,
  scanPreferencesFor,
} from "./practice-profile";

const TODAY = "2026-10-22";
const prefs = (p: Partial<PracticePreferences> = {}): PracticePreferences => ({
  ...DEFAULT_PREFERENCES,
  avoid: [],
  ...p,
});
const sum = (w: Record<PracticeClass, number>) => Object.values(w).reduce((s, x) => s + x, 0);
const stocks = (w: Record<PracticeClass, number>) => w.us_stocks + w.intl_stocks;
const safe = (w: Record<PracticeClass, number>) => w.bonds + w.cash;

describe("profileFor", () => {
  it("with no preferences, is the level's model with the usual caps", () => {
    const p = profileFor(prefs(), { level: 4, today: TODAY });
    expect(p.level).toBe(4);
    expect(p.trades).toBe(true);
    expect(p.caps).toEqual(SCAN_CAPS);
    expect(p.avoid).toEqual([]);
    expect(sum(p.weights)).toBeCloseTo(1, 9);
  });

  it("a chosen level wins over the fallback", () => {
    expect(profileFor(prefs({ riskLevel: 2 }), { level: 5, today: TODAY }).level).toBe(2);
  });

  it("is plain data the backtests can store and read back", () => {
    const p = profileFor(prefs({ goalDate: "2030-01-01", avoid: ["tech"] }), {
      level: 5,
      today: TODAY,
    });
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });

  it("suggest only means no trades", () => {
    const p = profileFor(prefs({ mode: "suggest" }), { level: 3, today: TODAY });
    expect(p.trades).toBe(false);
    expect(p.rules[0]).toMatch(/Suggest only/);
  });

  describe("the largest drop", () => {
    it("keeps the level at or under one whose worst drop fits", () => {
      expect(levelForDrop(5, null)).toBe(5);
      expect(levelForDrop(5, LEVEL_WORST_DROP_PERCENT[5])).toBe(5);
      expect(levelForDrop(5, LEVEL_WORST_DROP_PERCENT[3])).toBe(3);
      expect(levelForDrop(2, 59)).toBe(2);
      expect(levelForDrop(5, 5)).toBe(1);
      const p = profileFor(prefs({ riskLevel: 5, maxDropPercent: 20 }), { level: 5, today: TODAY });
      expect(p.chosenLevel).toBe(5);
      expect(p.level).toBeLessThan(5);
      expect(p.rules.join(" ")).toMatch(/20% you can live with/);
    });
  });

  describe("the glide path", () => {
    it("moves toward bonds and cash as the goal date nears, never back", () => {
      const goal = "2040-06-01";
      let lastStocks = Infinity;
      let lastSafe = -Infinity;
      for (let year = 2026; year <= 2041; year++) {
        const today = `${year}-06-01`;
        for (const level of [1, 2, 3, 4, 5] as const) {
          const { weights } = glideWeights(level, goal, today);
          expect(stocks(weights)).toBeLessThanOrEqual(
            stocks(glideWeights(level, null, today).weights) + 1e-9,
          );
        }
        const { weights } = glideWeights(5, goal, today);
        expect(stocks(weights)).toBeLessThanOrEqual(lastStocks + 1e-9);
        expect(safe(weights)).toBeGreaterThanOrEqual(lastSafe - 1e-9);
        expect(sum(weights)).toBeCloseTo(1, 9);
        lastStocks = stocks(weights);
        lastSafe = safe(weights);
      }
      // At the date: all cash.
      expect(glideWeights(5, goal, "2040-06-01").weights.cash).toBe(1);
    });

    it("leaves a far-off goal on the level's own mix", () => {
      expect(glideWeights(3, "2060-01-01", TODAY).moved).toBe(false);
    });

    it("'I need this money in 2030' cuts stocks", () => {
      const p = profileFor(prefs({ goalDate: "2030-01-01" }), { level: 5, today: TODAY });
      expect(p.glide).not.toBeNull();
      expect(stocks(p.weights)).toBeLessThan(
        stocks(profileFor(prefs(), { level: 5, today: TODAY }).weights),
      );
    });
  });

  describe("the person's strategy, rebalance pace, universe and cap on one fund", () => {
    it("sets the band and lowers the per-fund cap, never above the hard limits", () => {
      const p = profileFor(prefs({ rebalancePace: "rarely", maxFundPercent: 40 }), {
        level: 3,
        today: TODAY,
      });
      expect(p.limits.rebalanceBand).toBe(0.08);
      expect(p.limits.perEtfShare).toBe(0.4);
      expect(p.limits.perStockShare).toBe(AUTOPILOT_LIMITS.perStockShare);
      expect(p.rules).toContain("Rebalanced rarely: when a kind is 8 points off its target.");
      expect(p.rules.some((r) => r.startsWith("No fund over 40%"))).toBe(true);
      for (const pace of ["often", "normal", "rarely"] as const)
        for (const cap of [null, 20, 80])
          expect(
            profileFor(prefs({ rebalancePace: pace, maxFundPercent: cap }), {
              level: 3,
              today: TODAY,
            }).limits.perEtfShare,
          ).toBeLessThanOrEqual(AUTOPILOT_LIMITS.perEtfShare);
    });

    it("with funds only, never buys a company's shares and has no news ideas", () => {
      const p = profileFor(prefs({ universe: "funds_only" }), { level: 5, today: TODAY });
      for (const t of PRACTICE_STOCKS) expect(p.avoid).toContain(t);
      expect(p.opportunityKinds).not.toContain("news_idea");
      expect(refusedByPreferences(p, { ticker: "AAPL", side: "buy" })).toBe(
        "on your never-buy list",
      );
      expect(refusedByPreferences(p, { ticker: "VTI", side: "buy" })).toBeNull();
      expect(scanPreferencesFor(prefs({ universe: "funds_only" })).excludedTickers).toEqual(
        expect.arrayContaining([...PRACTICE_STOCKS]),
      );
      // The default keeps the companies open at High and Very high.
      expect(profileFor(prefs(), { level: 5, today: TODAY }).avoid).toEqual([]);
    });

    it("carries the strategy choice, and says when the person chose the mix alone", () => {
      expect(profileFor(prefs(), { level: 3, today: TODAY }).strategyChoice).toBe("level");
      const mix = profileFor(prefs({ strategy: "mix" }), { level: 3, today: TODAY });
      expect(mix.strategyChoice).toBe("mix");
      expect(mix.rules).toContain("Just the level's mix, as you chose: no strategy on top.");
    });
  });

  describe("hard caps always win", () => {
    it.each(APPETITE_ORDER)(
      "at %s, no cap passes the hard caps or the autopilot's limits",
      (appetite) => {
        for (const level of [1, 2, 3, 4, 5] as const) {
          const p = profileFor(prefs({ appetite }), { level, today: TODAY });
          // With the defaults, the person's limits are the hard ones.
          expect(p.limits).toEqual(AUTOPILOT_LIMITS);
          expect(p.opportunityMaxShare).toBeLessThanOrEqual(OPPORTUNITY_HARD_MAX_SHARE);
          for (const kind of SCAN_KINDS) {
            const hard = OPPORTUNITY_HARD_CAPS[kind];
            if (hard) {
              expect(p.caps[kind].sizeShare).toBeLessThanOrEqual(hard.sizeShare);
              expect(p.caps[kind].positionShare).toBeLessThanOrEqual(hard.positionShare);
              expect(p.caps[kind].perMonth).toBeLessThanOrEqual(hard.perMonth);
            } else {
              // Not an extra move: the usual caps, never more.
              expect(p.caps[kind].sizeShare).toBeLessThanOrEqual(SCAN_CAPS[kind].sizeShare);
              expect(p.caps[kind].perMonth).toBeLessThanOrEqual(SCAN_CAPS[kind].perMonth);
            }
          }
          expect(p.caps.news_idea.positionShare).toBeLessThanOrEqual(
            AUTOPILOT_LIMITS.perStockShare,
          );
        }
      },
    );

    it("news ideas stay at High and Very high, even when adventurous", () => {
      for (const level of [1, 2, 3] as const) {
        const p = profileFor(prefs({ appetite: "adventurous" }), { level, today: TODAY });
        expect(p.caps.news_idea.perMonth).toBe(0);
        expect(p.opportunityKinds).not.toContain("news_idea");
      }
      expect(
        profileFor(prefs({ appetite: "adventurous" }), { level: 5, today: TODAY }).opportunityKinds,
      ).toContain("news_idea");
    });

    it("more appetite never means smaller caps; off means no extra moves", () => {
      const at = (a: (typeof APPETITE_ORDER)[number]) =>
        profileFor(prefs({ appetite: a }), { level: 5, today: TODAY });
      for (let i = 1; i < APPETITE_ORDER.length; i++) {
        const lo = at(APPETITE_ORDER[i - 1]);
        const hi = at(APPETITE_ORDER[i]);
        for (const kind of SCAN_KINDS) {
          expect(hi.caps[kind].perMonth).toBeGreaterThanOrEqual(lo.caps[kind].perMonth);
          expect(hi.caps[kind].sizeShare).toBeGreaterThanOrEqual(lo.caps[kind].sizeShare);
        }
      }
      const off = at("off");
      expect(off.opportunityKinds).toEqual([]);
      expect(off.caps.dip_buy.perMonth).toBe(0);
      expect(off.caps.news_idea.perMonth).toBe(0);
      // Keeping the plan on target isn't an extra move.
      expect(off.caps.drift_rebalance).toEqual(SCAN_CAPS.drift_rebalance);
    });
  });

  it("the appetite scales only the extra moves: every other kind keeps its usual caps", () => {
    for (const appetite of APPETITE_ORDER) {
      const p = profileFor(prefs({ appetite }), { level: 5, today: TODAY });
      for (const kind of SCAN_KINDS) {
        if (OPPORTUNITY_MIN_APPETITE[kind]) continue;
        expect(p.caps[kind], `${appetite} ${kind}`).toEqual(SCAN_CAPS[kind]);
      }
    }
  });

  it("turning loss harvesting off allows none", () => {
    const p = profileFor(prefs({ harvestLosses: false }), { level: 3, today: TODAY });
    expect(p.caps.tax_loss_harvest.perMonth).toBe(0);
  });

  describe("exclusions", () => {
    it("resolve groups to the companies in them and keep named tickers", () => {
      expect(avoidedTickers(["tech"]).sort()).toEqual(["AAPL", "MSFT", "NVDA", "SMH", "TSLA"]);
      expect(avoidedTickers(["cars", "VTI"]).sort()).toEqual(["TSLA", "VTI"]);
      // A news theme's one-industry fund is that industry.
      expect(avoidedTickers(["fossil_fuels"])).toEqual(["XLE"]);
      expect(avoidedTickers(["weapons"])).toEqual(["ITA"]);
    });

    it("a kind whose every fund is avoided gives its share to another kind", () => {
      const p = profileFor(prefs({ avoid: ["VXUS", "IXUS"] }), { level: 4, today: TODAY });
      expect(p.weights.intl_stocks).toBe(0);
      expect(stocks(p.weights)).toBeCloseTo(0.75, 9);
      expect(sum(p.weights)).toBeCloseTo(1, 9);
      const all = Object.values(PRACTICE_ETFS).map((e) => e.ticker);
      const none = profileFor(prefs({ avoid: [...all, "ITOT", "IXUS", "AGG"] }), {
        level: 3,
        today: TODAY,
      });
      expect(sum(none.weights)).toBe(0);
    });
  });
});
