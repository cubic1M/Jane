import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn() }));
import { RULE_TUNE_DROP_SLACK_POINTS, RULE_TUNE_MIN_GAIN } from "@/config/backtest";
import { PRACTICE_UNIVERSE } from "@/config/portfolios";
import { OPPORTUNITY_RULES_OFF } from "@/config/practice-scan";
import { realFixtureBars } from "@/lib/market/__fixtures__/real";
import { ruleReplays } from "@/lib/investments/rule-replay";
import { keep, scoreOf, wins, type Scored } from "./rule-tuning";

// How tuning experiments are judged (docs/backtests/log.md), and the real-closes fixture they
// run on: the rules turned off still earn their switch-off on it.

const s = (objective: number, worstDrop = -0.2): Scored => ({
  yearly: objective * -worstDrop,
  worstDrop,
  objective,
  trades: 10,
  costCents: 0,
});

describe("scoreOf", () => {
  it("is the yearly time-weighted return for each point of worst drop", () => {
    // 253 days (252 steps) is one year: +10% with a 20% worst drop scores 0.5.
    const index = Array.from({ length: 253 }, (_, i) => ({ date: `d${i}`, valueCents: 1 }));
    const out = scoreOf({
      totalReturn: 0.1,
      worstDrop: { fraction: -0.2 } as never,
      index,
      trades: [],
      costCents: 0,
    });
    expect(out.yearly).toBeCloseTo(0.1, 10);
    expect(out.objective).toBeCloseTo(0.5, 10);
  });
});

describe("keep", () => {
  const gain = 1 + RULE_TUNE_MIN_GAIN * 2;
  it("keeps a change only when it wins in training and on the held-out years", () => {
    const train = { candidate: s(0.5 * gain), current: s(0.5), plain: s(0.5) };
    const held = { candidate: s(0.4 * gain), current: s(0.4), plain: s(0.4) };
    expect(keep(train, held).kept).toBe(true);
    expect(keep({ ...train, candidate: s(0.5) }, held)).toMatchObject({
      kept: false,
      why: "training: not better than the current settings",
    });
    expect(keep(train, { ...held, plain: s(0.5) })).toMatchObject({
      kept: false,
      why: "held-out: not better than plain rebalancing",
    });
  });

  it("refuses a worst drop past plain rebalancing's plus the slack", () => {
    const deep = -0.2 - (RULE_TUNE_DROP_SLACK_POINTS + 0.5) / 100;
    expect(wins({ candidate: s(1, deep), current: s(0.5), plain: s(0.5) }, true)).toEqual({
      ok: false,
      why: "worst drop past tolerance",
    });
  });
});

describe("the real-closes fixture", () => {
  it("has every practice ticker from Jan 4, 2016, oldest first", () => {
    const bars = realFixtureBars();
    expect(new Set(Object.keys(bars))).toEqual(new Set(PRACTICE_UNIVERSE));
    for (const b of Object.values(bars)) {
      expect(b[0].date).toBe("2016-01-04");
      expect(b.length).toBeGreaterThan(2_700);
      expect(b.every((x, i) => i === 0 || x.date > b[i - 1].date)).toBe(true);
    }
  });

  it("still shows every turned-off rule making its level worse", { timeout: 120_000 }, () => {
    const levels = Object.keys(OPPORTUNITY_RULES_OFF).map(Number) as (1 | 2 | 3 | 4 | 5)[];
    const r = ruleReplays(realFixtureBars(), [], levels)!;
    for (const l of r.levels)
      for (const off of OPPORTUNITY_RULES_OFF[l.level] ?? []) {
        const v = l.verdicts.find((x) => x.rule === off.rule)!;
        expect(v.status).toBe("off");
        expect(v.returnPoints!).toBeLessThan(0);
      }
  });
});
