import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import { STRATEGY_NOT_A_FORECAST } from "@/config/strategies";
import { MENU_STRATEGIES, MENU_STRATEGY_IDS, type MenuStrategyId } from "@/config/strategy-menu";
import {
  MENU_EVIDENCE,
  MENU_EVIDENCE_RANGE,
  MENU_EVIDENCE_SOURCE,
} from "@/config/strategy-menu-evidence";
import { longDate } from "@/lib/investments/backtest";

// The strategy menu on the investments page (Phase AW, Stage A): more ways to run the practice
// portfolio than Jane's pick for its level, each as a card with its line, a small equity curve,
// its worst drop and yearly return at the person's level against the level's own mix, and the
// levels it fits. A replay of the past, never a forecast; demo advice, always labelled.

const LEVELS = [1, 2, 3, 4, 5] as const;
const pct = (n: number) => `${(Math.round(n * 1000) / 10).toFixed(1)}%`;

export function fitsLevels(id: MenuStrategyId): RiskLevel[] {
  return LEVELS.filter((l) => MENU_EVIDENCE[id][l].fits);
}

export function Sparkline({ points, label }: { points: readonly number[]; label: string }) {
  const w = 120;
  const h = 32;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const y = (v: number) => h - 2 - ((v - lo) / Math.max(1e-9, hi - lo)) * (h - 4);
  const d = points
    .map((v, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label}>
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function StrategyMenuSection({ level }: { level: RiskLevel }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="strategy-menu-heading">
      <div className="flex flex-col gap-1">
        <h2 id="strategy-menu-heading" className="text-xl font-semibold">
          More strategies
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Your practice portfolio follows Jane&apos;s pick for {RISK_LEVELS[level].label}. These are
          other well-known ways to run it, each replayed on real prices from{" "}
          {longDate(MENU_EVIDENCE_RANGE.from)} to {longDate(MENU_EVIDENCE_RANGE.to)} after costs,
          against your level&apos;s own mix over the same days.
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {MENU_STRATEGY_IDS.map((id) => {
          const s = MENU_STRATEGIES[id];
          const r = MENU_EVIDENCE[id][level];
          const fits = fitsLevels(id);
          const last = r.curve.at(-1) ?? 100;
          return (
            <li
              key={id}
              data-strategy={id}
              className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{s.label}</p>
                <Sparkline
                  points={r.curve}
                  label={`${s.label}: $100 became $${last.toFixed(0)} at ${RISK_LEVELS[level].label}`}
                />
              </div>
              <p className="text-zinc-600 dark:text-zinc-400">{s.line}</p>
              <p className="text-xs text-zinc-500">
                At {RISK_LEVELS[level].label}: {pct(r.cagr)} a year (your mix {pct(r.mixCagr)}),
                worst drop {pct(r.maxDrawdown)} (your mix {pct(r.mixMaxDrawdown)}).{" "}
                {r.sortino > r.mixSortino
                  ? "More return for its risk than your mix."
                  : "Less return for its risk than your mix."}
              </p>
              <p className="text-xs text-zinc-500">
                Fits:{" "}
                {fits.length > 0 ? fits.map((l) => RISK_LEVELS[l].label).join(", ") : "no level"}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-zinc-500">
        {MENU_EVIDENCE_SOURCE}. {STRATEGY_NOT_A_FORECAST} Practice money only.
      </p>
      <DemoAdviceLabel />
    </section>
  );
}
