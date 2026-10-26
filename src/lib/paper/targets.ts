import { STRATEGY_ASSETS, STRATEGY_ASSET_IDS, strategyTickers } from "@/config/portfolios";
import type { RiskLevel } from "@/config/investing";
import { PAPER_HISTORY_DAYS } from "@/config/paper";
import { STRATEGY_RESEARCH_CHOICE } from "@/config/strategies";
import { CATALOG, CATALOG_MIX_FUNDS, type CatalogId } from "@/config/strategy-catalog";
import type { Bar } from "@/lib/market/types";
import { catalogTargets } from "@/planning/catalog-follow";
import { alignCatalog } from "@/planning/catalog/engine";
import { mixWeights } from "@/planning/paper";
import { alignUniverse } from "@/planning/strategies/engine";
import { limitsFor, targetWeights } from "@/planning/strategies/library";
import { daysBefore, type PaperPrices } from "./prices";

// What the person's chosen strategy holds this month, by fund: the catalog's own rule for a tested
// strategy (src/planning/catalog-follow.ts), or Jane's pick for the level (the strategy library's
// rule, src/planning/strategies/), from the closes before the month's decision day.

export type Targets = { targets: Record<string, number>; signalDate: string };

async function bars(source: PaperPrices, tickers: readonly string[], asOf: string) {
  const from = daysBefore(asOf, PAPER_HISTORY_DAYS);
  const out: Record<string, Bar[]> = {};
  for (const t of [...new Set(tickers)]) out[t] = await source.closes(t, from, asOf);
  return out;
}

export async function strategyTargets(
  key: string,
  level: RiskLevel,
  asOf: string,
  source: PaperPrices,
): Promise<Targets | null> {
  if (key.startsWith("catalog:")) {
    const id = key.slice(8) as CatalogId;
    if (!Object.hasOwn(CATALOG, id)) return null;
    const u = alignCatalog(
      await bars(source, [...CATALOG[id].tickers, ...Object.values(CATALOG_MIX_FUNDS)], asOf),
    );
    if (!u) return null;
    const grid = CATALOG[id].grid;
    const f = catalogTargets(id, grid[Math.floor((grid.length - 1) / 2)], u, level);
    return f ? { targets: f.targets, signalDate: f.signalDate } : null;
  }
  const choice = STRATEGY_RESEARCH_CHOICE[level];
  if (choice.id === "static") return { targets: mixWeights(level), signalDate: asOf };
  const data = alignUniverse(await bars(source, strategyTickers(), asOf));
  if (!data) return null;
  // The month's decision: the closes before its first trading day (or all of them, before it).
  const month = asOf.slice(0, 7);
  let t = data.dates.findIndex((d) => d >= `${month}-01`);
  if (t < 0) t = data.dates.length;
  if (t < 2) return null;
  const w = targetWeights(choice.id, choice.params, {
    date: data.dates[t] ?? asOf,
    closes: data.closes,
    t,
    limits: limitsFor(level),
    portfolio: { value: 1, peak: 1 },
  });
  const targets: Record<string, number> = {};
  for (const a of STRATEGY_ASSET_IDS) {
    const v = w[a] ?? 0;
    if (v > 0) targets[STRATEGY_ASSETS[a].ticker] = (targets[STRATEGY_ASSETS[a].ticker] ?? 0) + v;
  }
  return { targets, signalDate: data.dates[t - 1] };
}
