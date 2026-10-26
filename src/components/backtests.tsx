import { BacktestChart } from "@/components/backtest-chart";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { PRACTICE_ETFS } from "@/config/portfolios";
import { formatReturn } from "@/insights/returns";
import { longDate, type Backtests } from "@/lib/investments/backtest";
import { formatCents } from "@/lib/money";
import { monthlyPath } from "@/planning/backtest";
import { formatPercent as pct } from "@/lib/percent";

// Backtests by level on the investments page (spec step 295): the value paths as one chart, a
// few figures per level and the assumptions beside them. Demo advice, always labelled, and
// always called a replay, never a forecast.

const monthYear = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const bps = (n: number) => `${(n / 100).toFixed(2)}%`;
const drop = (fraction: number) => (fraction === 0 ? "None" : formatReturn(fraction));

export function BacktestsSection({ backtests }: { backtests: Backtests }) {
  const { levels, assumptions: a } = backtests;
  if (levels.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="backtests-heading">
      <div className="flex flex-col gap-1">
        <h2 id="backtests-heading" className="text-xl font-semibold">
          How each risk level would have done
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <strong>{backtests.label}</strong>, to {longDate(backtests.to)}:{" "}
          {formatCents(a.startCents)} in each level&apos;s model portfolio on the first day.{" "}
          {backtests.notAForecast}
        </p>
      </div>
      <BacktestChart
        series={levels.map((l) => ({
          level: l.level,
          label: l.label,
          points: monthlyPath(l.result.path),
        }))}
      />
      <ul className="flex flex-col gap-3 text-sm sm:hidden">
        {levels.map((l) => {
          const r = l.result;
          return (
            <li
              key={l.level}
              className="flex flex-col gap-1 border-t border-zinc-100 pt-2 first:border-0 first:pt-0 dark:border-zinc-900"
            >
              <span className="font-medium">
                {l.label}
                <span className="ml-1 text-xs font-normal text-zinc-500">
                  {pct(l.weights.us_stocks + l.weights.intl_stocks)} stocks
                </span>
              </span>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div>
                  <dt className="text-xs text-zinc-500">End value</dt>
                  <dd>{formatCents(r.endCents)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Worst drop</dt>
                  <dd>
                    {drop(r.worstDrop.fraction)}
                    {r.worstDrop.fraction !== 0 && (
                      <span className="block text-xs text-zinc-500">
                        {r.worstDrop.recoveredOn
                          ? `back ${monthYear(r.worstDrop.recoveredOn)}`
                          : "not back yet"}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Best year</dt>
                  <dd>
                    {r.bestYear ? `${formatReturn(r.bestYear.return)} (${r.bestYear.year})` : "–"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Worst year</dt>
                  <dd>
                    {r.worstYear
                      ? `${formatReturn(r.worstYear.return)} (${r.worstYear.year})`
                      : "–"}
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Figures for each risk level</caption>
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="font-normal">Level</th>
              <th className="pl-3 text-right font-normal">End value</th>
              <th className="pl-3 text-right font-normal">Worst drop</th>
              <th className="pl-3 text-right font-normal">Best year</th>
              <th className="pl-3 text-right font-normal">Worst year</th>
            </tr>
          </thead>
          <tbody>
            {levels.map((l) => {
              const r = l.result;
              return (
                <tr key={l.level} data-level={l.level} className="align-top">
                  <td className="py-1">
                    {l.label}
                    <span className="block text-xs text-zinc-500">
                      {pct(l.weights.us_stocks + l.weights.intl_stocks)} stocks
                    </span>
                  </td>
                  <td className="py-1 pl-3 text-right whitespace-nowrap">
                    {formatCents(r.endCents)}
                  </td>
                  <td className="py-1 pl-3 text-right whitespace-nowrap">
                    {drop(r.worstDrop.fraction)}
                    <span className="block text-xs text-zinc-500">
                      {r.worstDrop.fraction === 0
                        ? ""
                        : r.worstDrop.recoveredOn
                          ? `back ${monthYear(r.worstDrop.recoveredOn)}`
                          : "not back yet"}
                    </span>
                  </td>
                  <td className="py-1 pl-3 text-right whitespace-nowrap">
                    {r.bestYear ? formatReturn(r.bestYear.return) : "–"}
                    <span className="block text-xs text-zinc-500">{r.bestYear?.year}</span>
                  </td>
                  <td className="py-1 pl-3 text-right whitespace-nowrap">
                    {r.worstYear ? formatReturn(r.worstYear.return) : "–"}
                    <span className="block text-xs text-zinc-500">{r.worstYear?.year}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-1 text-xs text-zinc-500">
        <p className="font-medium text-zinc-600 dark:text-zinc-400">Assumptions</p>
        <ul className="list-disc pl-5">
          <li>
            Fund costs taken out daily:{" "}
            {Object.entries(PRACTICE_ETFS)
              .map(([c, e]) => `${e.ticker} ${bps(a.feeBps[c as keyof typeof a.feeBps])}`)
              .join(", ")}{" "}
            a year.
          </li>
          <li>
            Rebalanced back to the targets on any day a part drifts more than{" "}
            {a.rebalanceBandPoints} percentage points
            {a.tradeCostBps === 0 ? ", with no trading costs" : ""}.
          </li>
          <li>No taxes, and no money added or taken out.</li>
          <li>Best and worst year: whole calendar years only.</li>
          <li>{backtests.note}</li>
        </ul>
      </div>
      <DemoAdviceLabel />
    </section>
  );
}
