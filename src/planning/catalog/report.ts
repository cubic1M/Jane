import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import {
  CATALOG,
  CATALOG_ALSO_FROM_YEARS,
  CATALOG_MIN_DSR,
  CATALOG_TRAIN_END,
  CATALOG_WALK_FROM_YEAR,
  type CatalogId,
} from "@/config/strategy-catalog";
import type { CatalogMetrics, CatalogResult } from "./engine";

// The catalog's results written up (Phase AW, Stage A): docs/backtests/strategy-results.md, a
// ranked table per risk level, and src/config/catalog-evidence.ts, the compact record the app
// reads. Pure.

const pct = (n: number | undefined) =>
  n === undefined || !Number.isFinite(n) ? "–" : `${(Math.round(n * 1000) / 10).toFixed(1)}%`;
const num = (n: number | undefined, d = 2) =>
  n === undefined || !Number.isFinite(n) ? "–" : n.toFixed(d);

export function resultsMarkdown(
  results: readonly CatalogResult[],
  meta: { source: string; from: string; to: string; trials: number },
): string {
  const lines = [
    "# Strategy results",
    "",
    `Every strategy in [the catalog](strategy-catalog.md), replayed on ${meta.source}, ${meta.from} to ${meta.to}, after costs. A replay of the past, not a forecast; practice money and demo advice only.`,
    "",
    "- **Walk-forward:** each year from " +
      `${CATALOG_WALK_FROM_YEAR} is scored with the setting (and, for whole portfolios, the blend with bills that matches the level's volatility) chosen by Sortino on the years before it.`,
    `- **Several start years:** the walk-forward must also beat the mix measured from ${CATALOG_ALSO_FROM_YEARS.join(" and ")}.`,
    `- **Fixed split:** chosen on the years to ${CATALOG_TRAIN_END}, scored from ${Number(CATALOG_TRAIN_END.slice(0, 4)) + 1}.`,
    `- **The haircut:** ${meta.trials} trials were tested (every strategy at every setting). The deflated Sharpe ratio (Bailey & López de Prado, 2014) of each walk-forward's daily excess over the level's mix, against the best Sharpe ratio that many trials would show by luck, is the chance its edge is real.`,
    `- **Recommendable** only with that chance at least ${Math.round(CATALOG_MIN_DSR * 100)}%, more return for its risk than the mix both since ${CATALOG_WALK_FROM_YEAR} and from 2022, and no riskier than the level's budget or its own mix.`,
    "",
  ];
  for (const level of [1, 2, 3, 4, 5] as const) {
    const rows = results
      .filter((r) => r.level === level)
      .sort((a, b) => (b.walk?.sortino ?? -9) - (a.walk?.sortino ?? -9));
    const mix = rows.find((r) => r.mixWalk)?.mixWalk;
    const mixLater = rows.find((r) => r.mixLater)?.mixLater;
    const rec = rows.filter((r) => r.recommendable);
    const watch = rows.filter((r) => r.watch);
    lines.push(
      `## ${RISK_LEVELS[level].label}`,
      "",
      `The level's own mix since ${CATALOG_WALK_FROM_YEAR}: ${pct(mix?.cagr)} a year, worst drop ${pct(mix?.maxDrawdown)}, Sortino ${num(mix?.sortino)}; from 2022: ${pct(mixLater?.cagr)} a year, Sortino ${num(mixLater?.sortino)}.`,
      "",
      rec.length > 0
        ? `Recommendable: ${rec.map((r) => CATALOG[r.id].label).join(", ")}.`
        : "Recommendable: none. Nothing beat the mix by enough to survive the haircut for testing this many strategies.",
      "",
      watch.length > 0
        ? `Worth watching (beat the mix out of sample, inside the risk budget, but the edge could still be luck): ${watch.map((r) => `${CATALOG[r.id].label} (${Math.round(r.dsr * 100)}%)`).join(", ")}.`
        : "Worth watching: none.",
      "",
      "| # | Strategy | Since 2020: a year | Worst drop | Volatility | Sortino | Calmar | Worst year | From 2022: a year | From 2022: Sortino | Turnover | Excess Sharpe | Real edge (DSR) | Verdict |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...rows.map(
        (r, i) =>
          `| ${i + 1} | ${CATALOG[r.id].label} | ${pct(r.walk?.cagr)} | ${pct(r.walk?.maxDrawdown)} | ${pct(r.walk?.vol)} | ${num(r.walk?.sortino)} | ${num(r.walk?.calmar)} | ${pct(r.walk?.worstYear)} | ${pct(r.later?.cagr)} | ${num(r.later?.sortino)} | ${num(r.turnover, 1)}× | ${num(r.excessSharpe)} | ${Math.round(r.dsr * 100)}% | ${r.recommendable ? "**recommendable**" : r.watch ? `worth watching: ${r.why}` : `tested, not recommended: ${r.why}`} |`,
      ),
      "",
    );
  }
  return lines.join("\n") + "\n";
}

// The compact record the app reads: per strategy and level, the walk-forward's numbers against
// the mix, the haircut and the verdict.
type Slim = {
  cagr: number;
  maxDrawdown: number;
  sortino: number;
  mixCagr: number;
  mixSortino: number;
  dsr: number;
  recommendable: boolean;
  watch: boolean;
  why: string;
};
const r4 = (n: number | undefined) =>
  n === undefined || !Number.isFinite(n) ? 0 : Math.round(n * 10_000) / 10_000;
const slim = (r: CatalogResult): Slim => ({
  cagr: r4(r.walk?.cagr),
  maxDrawdown: r4(r.walk?.maxDrawdown),
  sortino: r4(r.walk?.sortino),
  mixCagr: r4(r.mixWalk?.cagr),
  mixSortino: r4(r.mixWalk?.sortino),
  dsr: r4(r.dsr),
  recommendable: r.recommendable,
  watch: r.watch,
  why: r.why,
});

export function evidenceModule(
  results: readonly CatalogResult[],
  meta: { source: string; from: string; to: string; trials: number },
): string {
  const byId = new Map<CatalogId, Partial<Record<RiskLevel, Slim>>>();
  for (const r of results) {
    const m = byId.get(r.id) ?? {};
    m[r.level] = slim(r);
    byId.set(r.id, m);
  }
  const rows = [...byId.entries()].map(([id, levels]) => `  ${id}: ${JSON.stringify(levels)},`);
  return `import type { RiskLevel } from "@/config/investing";
import type { CatalogId } from "@/config/strategy-catalog";

// The strategy catalog's results (src/planning/catalog/, docs/backtests/strategy-results.md):
// per strategy and risk level, the walk-forward since ${CATALOG_WALK_FROM_YEAR} against the level's mix, the
// deflated Sharpe ratio after the haircut for every trial, and the verdict. Written by the
// strategy research workflow (kind: catalog) on Alpaca's daily closes. A replay of the past,
// not a forecast. Fractions throughout.

export type CatalogEvidence = {
  cagr: number;
  maxDrawdown: number;
  sortino: number;
  mixCagr: number;
  mixSortino: number;
  dsr: number;
  recommendable: boolean;
  watch: boolean;
  why: string;
};

export const CATALOG_EVIDENCE_SOURCE = ${JSON.stringify(`${meta.source}, ${meta.from} to ${meta.to}, ${meta.trials} trials`)};

export const CATALOG_EVIDENCE: Readonly<
  Partial<Record<CatalogId, Partial<Record<RiskLevel, CatalogEvidence>>>>
> = {
${rows.join("\n")}
};
`;
}

export type { CatalogMetrics };
