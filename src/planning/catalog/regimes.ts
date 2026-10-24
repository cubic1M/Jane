import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import {
  CATALOG,
  CATALOG_IDS,
  CATALOG_REGIMES,
  OVERLAY_FUNDS,
  type CatalogId,
} from "@/config/strategy-catalog";
import {
  blend,
  daily,
  levelReturns,
  metricsOver,
  mixReturns,
  standalone,
  type CatalogMetrics,
} from "./engine";
import type { Universe } from "./strategies";

// The catalog through past regimes (the founder's batch 8): on the longer history, each strategy
// at its published middle setting (no choosing), at every level, against the level's mix over the
// whole run and through each of CATALOG_REGIMES. Descriptive: whole portfolios are blended with
// bills to the mix's volatility over the whole run. Pure.

export type RegimeRow = {
  id: CatalogId;
  level: RiskLevel;
  param: number;
  from: string;
  whole: CatalogMetrics | null;
  mixWhole: CatalogMetrics | null;
  // Total return through each regime, the strategy's and the mix's; null where it hadn't started.
  regimes: { label: string; strategy: number | null; mix: number | null }[];
};

const middle = (grid: readonly number[]) => grid[Math.floor((grid.length - 1) / 2)];

function totalOver(u: Universe, r: readonly number[], from: string, to: string): number | null {
  let v = 1;
  let seen = false;
  for (let t = 0; t < u.dates.length; t += 1) {
    if (u.dates[t] < from || u.dates[t] > to) continue;
    if (!Number.isFinite(r[t])) return null;
    v *= 1 + r[t];
    seen = true;
  }
  return seen ? v - 1 : null;
}

export function regimeReport(u: Universe, ids: readonly CatalogId[] = CATALOG_IDS): RegimeRow[] {
  const rows: RegimeRow[] = [];
  for (const id of ids) {
    const p = middle(CATALOG[id].grid);
    let s: number[];
    let start: number;
    let parts: Record<string, number[]> | undefined;
    if (CATALOG[id].kind === "overlay") {
      const runs = OVERLAY_FUNDS.map((_, f) => standalone(id, p, u, f));
      if (runs.some((x) => x === null)) continue;
      start = Math.max(...runs.map((x) => x!.start));
      parts = Object.fromEntries(
        OVERLAY_FUNDS.map((fund, f) => [
          fund,
          daily(runs[f]!.values).map((x, t) => (t > start ? x : Number.NaN)),
        ]),
      );
      s = parts[OVERLAY_FUNDS[0]];
    } else {
      const run = standalone(id, p, u);
      if (!run) continue;
      start = run.start;
      s = daily(run.values);
    }
    for (const level of [1, 2, 3, 4, 5] as const) {
      const mix = mixReturns(u, level);
      const last = u.dates.length - 1;
      const k = CATALOG[id].kind === "portfolio" ? blend(u, s, level, mix, start + 1, last) : 1;
      if (k === null) continue;
      const r = levelReturns(u, id, s, level, k, parts);
      rows.push({
        id,
        level,
        param: p,
        from: u.dates[start],
        whole: metricsOver(u, r, start + 1, last),
        mixWhole: metricsOver(u, mix, start + 1, last),
        regimes: CATALOG_REGIMES.map((g) => ({
          label: g.label,
          strategy: u.dates[start] < g.from ? totalOver(u, r, g.from, g.to) : null,
          mix: totalOver(u, mix, g.from, g.to),
        })),
      });
    }
  }
  return rows;
}

const pct = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "–"
    : `${(Math.round(n * 1000) / 10).toFixed(1)}%`;

export function regimesMarkdown(
  rows: readonly RegimeRow[],
  source: string,
  watch: readonly CatalogId[],
): string {
  const lines = [
    "## Through past regimes (longer history)",
    "",
    `On ${source}. Each strategy at its published middle setting, with no choosing, so this is descriptive and not a walk-forward: there are too few years before 2008 to choose settings on. Whole portfolios are blended with bills to the mix's volatility over the whole run. A strategy that hadn't started yet shows –.`,
    "",
  ];
  for (const level of [1, 2, 3, 4, 5] as const) {
    const mine = rows
      .filter((r) => r.level === level)
      .sort(
        (a, b) =>
          (watch.includes(b.id) ? 1 : 0) - (watch.includes(a.id) ? 1 : 0) ||
          (b.whole?.sortino ?? -9) - (a.whole?.sortino ?? -9),
      );
    const mix = mine.find((r) => r.mixWhole);
    lines.push(
      `### ${RISK_LEVELS[level].label}`,
      "",
      `The level's mix: ${CATALOG_REGIMES.map((g, i) => `${g.label} ${pct(mix?.regimes[i].mix)}`).join(", ")}.`,
      "",
      `| Strategy | From | A year | Worst drop | Sortino | Mix: a year | ${CATALOG_REGIMES.map((g) => g.label).join(" | ")} |`,
      `| --- | --- | --- | --- | --- | --- | ${CATALOG_REGIMES.map(() => "---").join(" | ")} |`,
      ...mine.map(
        (r) =>
          `| ${watch.includes(r.id) ? "**" : ""}${CATALOG[r.id].label}${watch.includes(r.id) ? "**" : ""} | ${r.from} | ${pct(r.whole?.cagr)} | ${pct(r.whole?.maxDrawdown)} | ${r.whole?.sortino.toFixed(2) ?? "–"} | ${pct(r.mixWhole?.cagr)} | ${r.regimes.map((g) => `${pct(g.strategy)} (mix ${pct(g.mix)})`).join(" | ")} |`,
      ),
      "",
    );
  }
  return lines.join("\n") + "\n";
}
