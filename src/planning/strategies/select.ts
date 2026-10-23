import type { RiskLevel } from "@/config/investing";
import {
  STRATEGY_GRID,
  STRATEGY_MIN_SORTINO_GAIN,
  STRATEGY_START_YEARS,
  STRATEGY_TRAIN_END,
  type StrategyId,
} from "@/config/strategies";
import { rangeOf, replayStrategy, type Aligned, type Metrics } from "./engine";
import { limitsFor } from "./library";
import type { Candidate, LevelLimits, Params } from "./types";

// Choosing each level's strategy without fitting the past (Phase AW, Stage A). For each start
// year, every candidate (each strategy with each of its few parameter sets) is replayed on the
// training years (the start year to STRATEGY_TRAIN_END) and, from a fresh start, on the years
// after. The pick is the best Sortino inside the level's budget in training. It is kept only if,
// on the later years, it stays inside the budget and beats the level's mix (rebalanced on the
// band) by STRATEGY_MIN_SORTINO_GAIN, and the picks from every other start year do too.
// Otherwise the level keeps its mix. Pure. A replay of the past, never a forecast.

// Every strategy with each of its parameter sets, from STRATEGY_GRID.
export function candidates(): Candidate[] {
  const out: Candidate[] = [];
  for (const id of Object.keys(STRATEGY_GRID) as StrategyId[]) {
    const grid = STRATEGY_GRID[id] as Readonly<Record<string, readonly (number | string)[]>>;
    let sets: Params[] = [{}];
    for (const [key, values] of Object.entries(grid))
      sets = sets.flatMap((s) => values.map((v) => ({ ...s, [key]: v })));
    for (const params of sets) out.push({ id, params });
  }
  return out;
}

export const BASELINE: Candidate = { id: "static", params: { rebalance: "band" } };
export const keyOf = (c: Candidate) =>
  `${c.id}(${Object.entries(c.params)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")})`;

export const insideBudget = (m: Metrics, limits: LevelLimits) =>
  m.maxDrawdown <= limits.maxDrawdown + 1e-9 && m.vol <= limits.volCap + 1e-9;

// Beats the baseline on the later years: inside the budget and a better Sortino by the margin
// (or the baseline itself is outside the budget there).
export function beatsBaseline(m: Metrics, base: Metrics, limits: LevelLimits): boolean {
  if (!insideBudget(m, limits)) return false;
  if (!insideBudget(base, limits)) return true;
  return m.sortino >= base.sortino + Math.abs(base.sortino) * STRATEGY_MIN_SORTINO_GAIN;
}

export type CandidateResult = { candidate: Candidate; key: string; train: Metrics; test: Metrics };

export type StartYearResult = {
  startYear: number;
  // The training pick and whether it beat the baseline on the later years.
  pick: string;
  passed: boolean;
  results: CandidateResult[];
};

export type LevelSelection = {
  level: RiskLevel;
  chosen: Candidate;
  chosenKey: string;
  // Why, in a sentence with the numbers.
  why: string;
  baseline: { train: Metrics; test: Metrics };
  // The chosen strategy's own numbers (the baseline's when it is the mix).
  train: Metrics;
  test: Metrics;
  byStartYear: StartYearResult[];
};

const pct = (n: number) => `${(Math.round(n * 1000) / 10).toFixed(1)}%`;
const ratio = (n: number) => n.toFixed(2);

// Training: the best Sortino inside the budget, else the shallowest worst drop.
export function pickOnTraining(
  results: readonly CandidateResult[],
  limits: LevelLimits,
): CandidateResult {
  const inside = results.filter((r) => insideBudget(r.train, limits));
  const pool = inside.length > 0 ? inside : results;
  return pool.reduce((best, r) =>
    inside.length > 0
      ? r.train.sortino > best.train.sortino
        ? r
        : best
      : r.train.maxDrawdown < best.train.maxDrawdown
        ? r
        : best,
  );
}

// The decision from every start year's results (pure, for a hand-built test): the first start
// year's training pick, kept only if every start year's pick beat the baseline on the later years.
export function decide(
  level: RiskLevel,
  byStartYear: readonly StartYearResult[],
): LevelSelection | null {
  if (byStartYear.length === 0) return null;
  const first = byStartYear[0];
  const base = first.results.find((r) => r.key === keyOf(BASELINE));
  const pick = first.results.find((r) => r.key === first.pick);
  if (!base || !pick) return null;
  const kept = byStartYear.every((y) => y.passed);
  const chosen = kept ? pick : base;
  const why = kept
    ? `Chosen on ${first.startYear} to ${STRATEGY_TRAIN_END.slice(0, 4)} (Sortino ${ratio(pick.train.sortino)}, worst drop ${pct(pick.train.maxDrawdown)}), it then beat the level's mix on the later years: Sortino ${ratio(pick.test.sortino)} against ${ratio(base.test.sortino)}, worst drop ${pct(pick.test.maxDrawdown)} against ${pct(base.test.maxDrawdown)}, from every start year tried.`
    : first.pick === base.key
      ? `The level's mix was the best in training, so it stays.`
      : `The training pick (${first.pick}) didn't beat the level's mix on the later years from every start year by ${pct(STRATEGY_MIN_SORTINO_GAIN)} of its Sortino inside the budget, so the mix stays: Sortino ${ratio(base.test.sortino)}, worst drop ${pct(base.test.maxDrawdown)} on the later years.`;
  return {
    level,
    chosen: chosen.candidate,
    chosenKey: chosen.key,
    why,
    baseline: { train: base.train, test: base.test },
    train: chosen.train,
    test: chosen.test,
    byStartYear: [...byStartYear],
  };
}

// One start year's results: every candidate's training and later-years numbers, and its pick.
export function startYearResult(
  startYear: number,
  results: CandidateResult[],
  limits: LevelLimits,
): StartYearResult | null {
  const base = results.find((r) => r.key === keyOf(BASELINE));
  if (!base) return null;
  const pick = pickOnTraining(results, limits);
  return {
    startYear,
    pick: pick.key,
    passed: pick.key !== base.key && beatsBaseline(pick.test, base.test, limits),
    results,
  };
}

export function selectForLevel(data: Aligned, level: RiskLevel): LevelSelection | null {
  const limits = limitsFor(level);
  const all = candidates();
  const byStartYear: StartYearResult[] = [];
  const test = rangeOf(data, `${Number(STRATEGY_TRAIN_END.slice(0, 4)) + 1}-01-01`, null);
  if (!test) return null;
  const testOf = new Map<string, Metrics>();
  for (const c of all) {
    const r = replayStrategy(data, c, limits, test.from, test.to);
    if (r) testOf.set(keyOf(c), r.metrics);
  }
  for (const startYear of STRATEGY_START_YEARS) {
    const train = rangeOf(data, `${startYear}-01-01`, STRATEGY_TRAIN_END);
    if (!train) continue;
    const results: CandidateResult[] = [];
    for (const c of all) {
      const r = replayStrategy(data, c, limits, train.from, train.to);
      const t = testOf.get(keyOf(c));
      if (r && t) results.push({ candidate: c, key: keyOf(c), train: r.metrics, test: t });
    }
    const y = startYearResult(startYear, results, limits);
    if (y) byStartYear.push(y);
  }
  return decide(level, byStartYear);
}
