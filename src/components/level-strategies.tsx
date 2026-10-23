import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import {
  RISK_BUDGETS,
  STRATEGY_LABELS,
  STRATEGY_NOT_A_FORECAST,
  STRATEGY_RESEARCH_CHOICE,
  STRATEGY_RESEARCH_RANGE,
} from "@/config/strategies";
import { formatReturn } from "@/insights/returns";
import { longDate } from "@/lib/investments/backtest";
import type { LatestStrategies } from "@/lib/investments/strategy-eval";

// "The strategy each level follows" on the investments page (Phase AW, Stage A): the weekly
// replay's choice per level, why (its numbers on the later years against the level's mix) and
// each level's risk budget. Demo advice, always labelled, and a replay, never a forecast.

const LEVELS = [1, 2, 3, 4, 5] as const;
const pct = (n: number) => `${(Math.round(n * 1000) / 10).toFixed(1)}%`;

export function LevelStrategiesSection({
  latest,
  level,
}: {
  latest: LatestStrategies | null;
  level?: RiskLevel;
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="level-strategies-heading">
      <div className="flex flex-col gap-1">
        <h2 id="level-strategies-heading" className="text-xl font-semibold">
          The strategy each level follows
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {latest ? (
            <>
              Each day Jane replays seven ways of running each level on real prices from{" "}
              {longDate(latest.from)} to {longDate(latest.to)}, chooses on the earlier years and
              keeps a strategy only if it then beat the level&apos;s mix on the later ones. The
              practice autopilot follows the choice. {STRATEGY_NOT_A_FORECAST}
            </>
          ) : (
            <>
              Jane replayed seven ways of running each level on Alpaca&apos;s real prices from{" "}
              {longDate(STRATEGY_RESEARCH_RANGE.from)} to {longDate(STRATEGY_RESEARCH_RANGE.to)},
              chose on the earlier years and kept a strategy only if it then beat the level&apos;s
              mix on the later ones. The practice autopilot follows the choice until the daily
              replay has run. {STRATEGY_NOT_A_FORECAST}
            </>
          )}
        </p>
      </div>
      {!latest && (
        <ul className="flex flex-col gap-2 text-sm">
          {LEVELS.map((l) => {
            const c = STRATEGY_RESEARCH_CHOICE[l];
            return (
              <li
                key={l}
                data-level={l}
                data-strategy={c.id}
                className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <p className="font-medium">
                  {RISK_LEVELS[l].label}
                  {l === level && (
                    <span className="ml-1 text-xs font-normal text-zinc-500">(your level)</span>
                  )}
                  : {STRATEGY_LABELS[c.id]}
                </p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">{c.why}</p>
              </li>
            );
          })}
        </ul>
      )}
      {latest && (
        <ul className="flex flex-col gap-2 text-sm">
          {LEVELS.map((l) => {
            const c = latest.byLevel[l];
            if (!c) return null;
            const budget = RISK_BUDGETS[l];
            return (
              <li
                key={l}
                data-level={l}
                data-strategy={c.key}
                className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <p className="font-medium">
                  {RISK_LEVELS[l].label}
                  {l === level && (
                    <span className="ml-1 text-xs font-normal text-zinc-500">(your level)</span>
                  )}
                  : {c.label}
                  <span className="ml-1 text-xs font-normal text-zinc-500">{c.key}</span>
                </p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-zinc-500">Later years, worst drop</dt>
                    <dd>
                      {pct(c.test.maxDrawdown)}{" "}
                      <span className="text-xs text-zinc-500">
                        (mix {pct(c.baseline.test.maxDrawdown)})
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">Later years, a year</dt>
                    <dd>
                      {formatReturn(c.test.cagr)}{" "}
                      <span className="text-xs text-zinc-500">
                        (mix {formatReturn(c.baseline.test.cagr)})
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">Sortino</dt>
                    <dd>
                      {c.test.sortino.toFixed(2)}{" "}
                      <span className="text-xs text-zinc-500">
                        (mix {c.baseline.test.sortino.toFixed(2)})
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">Budget</dt>
                    <dd>
                      drop {pct(budget.maxDrawdown)}, volatility {pct(budget.volCap)}
                    </dd>
                  </div>
                </dl>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">{c.why}</p>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-zinc-500">
        Practice money only: the strategies trade the practice portfolio, never a real account. No
        taxes in the replay.
      </p>
      <DemoAdviceLabel />
    </section>
  );
}
