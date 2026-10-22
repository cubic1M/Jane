import { writeFileSync } from "node:fs";
import { describe, it, vi } from "vitest";
import { RULE_TUNE_TRAIN, RULE_TUNE_VALIDATE } from "@/config/backtest";
import type { RiskLevel } from "@/config/investing";
import type * as Portfolios from "@/config/portfolios";
import type * as PracticeScan from "@/config/practice-scan";
import type { ScanKind } from "@/config/practice-scan";
import { realFixtureBars } from "@/lib/market/__fixtures__/real";
import type { Bar } from "@/lib/market/types";
import { keep, scoreOf, type Scored } from "./rule-tuning";

// The tuning runs behind docs/backtests/log.md: each experiment changes some rule numbers, and
// the real replay (src/planning/rule-replay.ts, re-imported with those numbers, so nothing is
// copied) runs every level on the real-closes fixture, trained on 2016–2021 and checked on 2022
// to now. Research only: it runs when RULE_TUNING_OUT names a file for the results, never in CI.

// Numbers widened from the config's literal types, so a run can try other values.
type Overrides = {
  scan?: Record<string, unknown>;
  limits?: Record<string, number>;
  // The opportunity rules on at each level; left out, the current ones.
  rules?: (level: RiskLevel, current: Set<ScanKind>) => Set<ScanKind>;
};
type Experiment = { name: string; o: Overrides };

const OUT = process.env.RULE_TUNING_OUT;
const LEVELS = [1, 2, 3, 4, 5] as const;
// The monthly money in every replay (RULE_TUNING_MONTHLY, in cents; the practice default otherwise).
const MONTHLY = Number(process.env.RULE_TUNING_MONTHLY ?? 50_000);

const upTo = (bars: Record<string, Bar[]>, to: string | null) =>
  Object.fromEntries(
    Object.entries(bars).map(([t, b]) => [t, to ? b.filter((x) => x.date <= to) : b]),
  );

async function withNumbers(o: Overrides) {
  vi.resetModules();
  vi.doMock("@/config/practice-scan", async (original) => {
    const actual = await original<typeof PracticeScan>();
    return { ...actual, ...o.scan };
  });
  vi.doMock("@/config/portfolios", async (original) => {
    const actual = await original<typeof Portfolios>();
    return { ...actual, AUTOPILOT_LIMITS: { ...actual.AUTOPILOT_LIMITS, ...o.limits } };
  });
  const replay = await import("./rule-replay");
  const config = await import("@/config/practice-scan");
  vi.doUnmock("@/config/practice-scan");
  vi.doUnmock("@/config/portfolios");
  return { replayRules: replay.replayRules, rulesOnAt: config.rulesOnAt };
}

async function run(o: Overrides, strategy: "rules" | "rebalance" | "hold") {
  const { replayRules, rulesOnAt } = await withNumbers(o);
  const all = realFixtureBars();
  const out: Record<string, { train: Scored; validate: Scored; acted: object }> = {};
  for (const level of LEVELS) {
    const current = rulesOnAt(level);
    const rules = o.rules ? o.rules(level, current) : current;
    const go = (bars: Record<string, Bar[]>, from: string) =>
      replayRules({
        level,
        bars,
        from,
        headlines: [],
        startCents: 1_000_000,
        monthlyAddCents: MONTHLY,
        addDay: 1,
        strategy,
        rules,
        tradeCostBps: 2,
      })!;
    const train = go(upTo(all, RULE_TUNE_TRAIN.to), RULE_TUNE_TRAIN.from);
    const validate = go(upTo(all, RULE_TUNE_VALIDATE.to), RULE_TUNE_VALIDATE.from);
    out[level] = {
      train: scoreOf(train),
      validate: scoreOf(validate),
      acted: { train: train.acted, validate: validate.acted },
    };
  }
  return out;
}

const harvestEverywhere = (_: RiskLevel, current: Set<ScanKind>) =>
  new Set([...current, "tax_loss_harvest" as const]);
const without = (rule: ScanKind) => (_: RiskLevel, current: Set<ScanKind>) =>
  new Set([...current].filter((k) => k !== rule));

function experiments(scan: typeof PracticeScan): Experiment[] {
  const dipCaps = (sizeShare: number) => ({
    SCAN_CAPS: { ...scan.SCAN_CAPS, dip_buy: { ...scan.SCAN_CAPS.dip_buy, sizeShare } },
  });
  const list: Experiment[] = [];
  for (const v of [0.05, 0.075, 0.125, 0.15])
    list.push({ name: `DIP_MIN_DROP ${v}`, o: { scan: { DIP_MIN_DROP: v } } });
  for (const v of [10, 40, 60])
    list.push({ name: `DIP_LOOKBACK_DAYS ${v}`, o: { scan: { DIP_LOOKBACK_DAYS: v } } });
  for (const v of [0.02, 0.1, 0.2])
    list.push({ name: `dip sizeShare ${v}`, o: { scan: dipCaps(v) } });
  for (const v of [0.02, 0.1])
    list.push({ name: `DIP_MAX_OVER_TARGET ${v}`, o: { scan: { DIP_MAX_OVER_TARGET: v } } });
  list.push({ name: "dip buys off", o: { rules: without("dip_buy") } });
  list.push({ name: "harvest on everywhere", o: { rules: harvestEverywhere } });
  for (const v of [0.05, 0.12, 0.2])
    list.push({
      name: `harvest on everywhere, HARVEST_MIN_LOSS_SHARE ${v}`,
      o: { scan: { HARVEST_MIN_LOSS_SHARE: v }, rules: harvestEverywhere },
    });
  list.push({ name: "harvest off everywhere", o: { rules: without("tax_loss_harvest") } });
  for (const v of [0.03, 0.08, 0.1])
    list.push({ name: `DRIFT_STOCKS_BAND ${v}`, o: { scan: { DRIFT_STOCKS_BAND: v } } });
  for (const v of [0.03, 0.075, 0.1])
    list.push({ name: `rebalanceBand ${v}`, o: { limits: { rebalanceBand: v } } });
  // The two bands together: a kind past rebalanceBand, or stocks together past DRIFT_STOCKS_BAND.
  for (const [band, stocks] of [
    [0.03, 0.03],
    [0.05, 0.075],
    [0.05, 0.1],
    [0.075, 0.075],
    [0.1, 0.1],
    [0.1, 0.15],
    [0.15, 0.15],
    [0.25, 0.25],
  ])
    list.push({
      name: `rebalanceBand ${band} + DRIFT_STOCKS_BAND ${stocks}`,
      o: { limits: { rebalanceBand: band }, scan: { DRIFT_STOCKS_BAND: stocks } },
    });
  const extra = process.env.RULE_TUNING_EXTRA;
  if (extra) list.push(...(JSON.parse(extra) as Experiment[]));
  return list;
}

describe.runIf(OUT)("rule tuning (research)", () => {
  it("runs every experiment and writes the results", async () => {
    const actual = await vi.importActual<typeof PracticeScan>("@/config/practice-scan");
    const only = process.env.RULE_TUNING_ONLY;
    const current = await run({}, "rules");
    const plain = await run({}, "rebalance");
    const hold = await run({}, "hold");
    const results = [];
    for (const e of experiments(actual).filter((x) => !only || x.name.includes(only))) {
      const cand = await run(e.o, "rules");
      const levels = LEVELS.map((level) => {
        const c = cand[level];
        const decision = keep(
          { candidate: c.train, current: current[level].train, plain: plain[level].train },
          {
            candidate: c.validate,
            current: current[level].validate,
            plain: plain[level].validate,
          },
        );
        return { level, ...c, ...decision };
      });
      results.push({ name: e.name, levels });
    }
    writeFileSync(OUT!, JSON.stringify({ current, plain, hold, results }, null, 1));
  }, 3_600_000);
});
