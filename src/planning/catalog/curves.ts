import type { RiskLevel } from "@/config/investing";
import { CATALOG_WALK_FROM_YEAR, type CatalogId } from "@/config/strategy-catalog";
import { STRATEGY_LABELS, STRATEGY_RESEARCH_CHOICE } from "@/config/strategies";
import { replayStrategy, type Aligned } from "../strategies/engine";
import { limitsFor } from "../strategies/library";
import { metricsOver, mixReturns, type CatalogResult, type runCatalog } from "./engine";
import type { Universe } from "./strategies";

// The investments page's graph (src/config/catalog-curves.ts): per risk level, every catalog
// strategy's walk-forward, the level's own mix and the practice portfolio's default (Jane's pick,
// STRATEGY_RESEARCH_CHOICE) on one month-end axis from CATALOG_WALK_FROM_YEAR, from 100. Written
// by the strategy research workflow (kind: catalog) so the page never fetches prices. Pure.

export type CurveStats = { cagr: number; maxDrawdown: number; sortino: number };
export type DefaultCurve = { label: string; values: (number | null)[]; stats: CurveStats };

const r4 = (n: number) => (Number.isFinite(n) ? Math.round(n * 10_000) / 10_000 : 0);

// Jane's pick for the level, replayed on the strategy library's engine from the axis' first day
// and read at each axis date (the last close on or before it).
export function defaultCurve(data: Aligned, level: RiskLevel, dates: readonly string[]) {
  const choice = STRATEGY_RESEARCH_CHOICE[level];
  const from = data.dates.findIndex((d) => d >= dates[0]);
  if (from < 0) return null;
  const replay = replayStrategy(
    data,
    { id: choice.id, params: choice.params },
    limitsFor(level),
    from,
    data.dates.length - 1,
  );
  if (!replay) return null;
  const start = replay.path[0].valueCents;
  let k = 0;
  const values = dates.map((d) => {
    while (k + 1 < replay.path.length && replay.path[k + 1].date <= d) k += 1;
    return replay.path[k].date <= d
      ? Math.round((replay.path[k].valueCents / start) * 1000) / 10
      : null;
  });
  const m = replay.metrics;
  return {
    label: STRATEGY_LABELS[choice.id],
    values,
    stats: { cagr: r4(m.cagr), maxDrawdown: r4(m.maxDrawdown), sortino: r4(m.sortino) },
  } satisfies DefaultCurve;
}

export function curvesModule(input: {
  results: readonly CatalogResult[];
  dates: readonly string[];
  mix: Readonly<Record<RiskLevel, { values: (number | null)[]; stats: CurveStats }>>;
  defaults: Readonly<Partial<Record<RiskLevel, DefaultCurve | null>>>;
  source: string;
}): string {
  const levels = ([1, 2, 3, 4, 5] as const).map((level) => {
    const strategies: Partial<Record<CatalogId, (number | null)[]>> = {};
    for (const r of input.results) if (r.level === level) strategies[r.id] = r.monthly;
    return `  ${level}: ${JSON.stringify({
      mix: input.mix[level],
      pick: input.defaults[level] ?? null,
      strategies,
    })},`;
  });
  return `import type { RiskLevel } from "@/config/investing";
import type { CatalogId } from "@/config/strategy-catalog";

// The investments page's graph (src/planning/catalog/curves.ts): per risk level, each catalog
// strategy's walk-forward since ${CATALOG_WALK_FROM_YEAR}, the level's own mix and Jane's pick for the level,
// on CATALOG_CURVE_DATES (month ends), from 100, after costs. Written by the strategy research
// workflow (kind: catalog). A replay of the past, not a forecast.

export type CurveStats = { cagr: number; maxDrawdown: number; sortino: number };
export type LevelCurves = {
  mix: { values: (number | null)[]; stats: CurveStats };
  pick: { label: string; values: (number | null)[]; stats: CurveStats } | null;
  strategies: Partial<Record<CatalogId, (number | null)[]>>;
};

export const CATALOG_CURVES_SOURCE = ${JSON.stringify(input.source)};

export const CATALOG_CURVE_DATES: readonly string[] = ${JSON.stringify(input.dates)};

export const CATALOG_CURVES: Readonly<Record<RiskLevel, LevelCurves>> = {
${levels.join("\n")}
};
`;
}

// The whole module from a catalog run: the mix's path and numbers over the axis, Jane's pick on
// the strategy library's own closes (null where they don't reach), every strategy's walk-forward.
export function catalogCurves(
  u: Universe,
  run: ReturnType<typeof runCatalog>,
  data: Aligned | null,
  source: string,
): string {
  const i0 = u.dates.indexOf(run.axis[0]) + 1;
  const last = u.dates.length - 1;
  const mix = {} as Record<RiskLevel, { values: (number | null)[]; stats: CurveStats }>;
  const defaults: Partial<Record<RiskLevel, DefaultCurve | null>> = {};
  for (const level of [1, 2, 3, 4, 5] as const) {
    const m = metricsOver(u, mixReturns(u, level), i0, last);
    mix[level] = {
      values: run.mixMonthly[level],
      stats: {
        cagr: r4(m?.cagr ?? 0),
        maxDrawdown: r4(m?.maxDrawdown ?? 0),
        sortino: r4(m?.sortino ?? 0),
      },
    };
    defaults[level] = data && run.axis.length > 0 ? defaultCurve(data, level, run.axis) : null;
  }
  return curvesModule({ results: run.results, dates: run.axis, mix, defaults, source });
}
