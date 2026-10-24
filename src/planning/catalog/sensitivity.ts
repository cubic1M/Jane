import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import {
  CATALOG,
  CATALOG_SENSITIVITY,
  CATALOG_WALK_FROM_YEAR,
  type CatalogId,
} from "@/config/strategy-catalog";
import { blend, daily, levelReturns, metricsOver, mixReturns, standalone } from "./engine";
import type { Universe } from "./strategies";

// How much each worth-watching strategy depends on its setting (batch 10): each setting in
// CATALOG_SENSITIVITY, held fixed, scored since CATALOG_WALK_FROM_YEAR at Medium and Very high
// against the mix; whole portfolios blended with bills to the mix's volatility over the years
// before. Descriptive, not trials. Pure.

export type SensitivityRow = {
  id: CatalogId;
  param: number;
  level: RiskLevel;
  cagr: number | null;
  sortino: number | null;
  mixSortino: number | null;
};

const LEVELS: readonly RiskLevel[] = [3, 5];

export function sensitivity(u: Universe): SensitivityRow[] {
  const from = u.dates.findIndex((d) => d >= `${CATALOG_WALK_FROM_YEAR}-01-01`);
  const last = u.dates.length - 1;
  const rows: SensitivityRow[] = [];
  for (const [id, params] of Object.entries(CATALOG_SENSITIVITY) as [CatalogId, number[]][]) {
    for (const p of params) {
      const run = standalone(id, p, u);
      if (!run || from < 0) continue;
      const s = daily(run.values);
      for (const level of LEVELS) {
        const mix = mixReturns(u, level);
        const k =
          CATALOG[id].kind === "portfolio" ? blend(u, s, level, mix, run.start + 1, from - 1) : 1;
        if (k === null) continue;
        const m = metricsOver(u, levelReturns(u, id, s, level, k), from, last);
        const mm = metricsOver(u, mix, from, last);
        rows.push({
          id,
          param: p,
          level,
          cagr: m?.cagr ?? null,
          sortino: m?.sortino ?? null,
          mixSortino: mm?.sortino ?? null,
        });
      }
    }
  }
  return rows;
}

const pct = (n: number | null) => (n === null ? "–" : `${(Math.round(n * 1000) / 10).toFixed(1)}%`);
const num = (n: number | null) => (n === null ? "–" : n.toFixed(2));

export function sensitivityMarkdown(rows: readonly SensitivityRow[], source: string): string {
  const lines = [
    "## How much the watch list depends on its setting",
    "",
    `On ${source}. Each worth-watching strategy at each setting, held fixed, since ${CATALOG_WALK_FROM_YEAR}, against the level's mix. Descriptive, not counted as trials. ✓ marks a setting with more return for its risk (Sortino) than the mix.`,
    "",
  ];
  for (const id of Object.keys(CATALOG_SENSITIVITY) as CatalogId[]) {
    const mine = rows.filter((r) => r.id === id);
    if (mine.length === 0) continue;
    const params = [...new Set(mine.map((r) => r.param))];
    const beat = mine.filter(
      (r) => r.sortino !== null && r.mixSortino !== null && r.sortino > r.mixSortino,
    ).length;
    lines.push(
      `### ${CATALOG[id].label} (${CATALOG[id].param})`,
      "",
      `Ahead of the mix at ${beat} of ${mine.length} settings and levels.`,
      "",
      `| Setting | ${LEVELS.map((l) => `${RISK_LEVELS[l].label}: a year, Sortino (mix)`).join(" | ")} |`,
      `| --- | ${LEVELS.map(() => "---").join(" | ")} |`,
      ...params.map(
        (p) =>
          `| ${p} | ${LEVELS.map((l) => {
            const r = mine.find((x) => x.param === p && x.level === l);
            if (!r) return "–";
            const ok = r.sortino !== null && r.mixSortino !== null && r.sortino > r.mixSortino;
            return `${pct(r.cagr)}, ${num(r.sortino)} (${num(r.mixSortino)})${ok ? " ✓" : ""}`;
          }).join(" | ")} |`,
      ),
      "",
    );
  }
  return lines.join("\n") + "\n";
}
