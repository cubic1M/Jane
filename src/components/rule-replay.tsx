import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { RULE_REPLAY_STRATEGY_LABELS } from "@/config/backtest";
import { formatReturn } from "@/insights/returns";
import { longDate } from "@/lib/investments/backtest";
import type {
  LevelRuleReplay,
  LoadedRuleReplays,
  RuleVerdict,
  StrategySummary,
} from "@/lib/investments/rule-replay";
import { formatCents } from "@/lib/money";

// "Did the extra rules help?" on the investments page: for each level, the practice autopilot
// with the daily scan's opportunity rules against plain rebalancing and buy and hold, replayed
// over the same history, and what each rule did on its own. Demo advice, always labelled, and
// always called a replay, never a forecast.

const STRATEGIES = ["rules", "rebalance", "hold"] as const;
const drop = (fraction: number | null) =>
  fraction === null ? "–" : fraction === 0 ? "None" : formatReturn(fraction);
const points = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)} pts`;

const STATUS: Record<RuleVerdict["status"], string> = {
  helped: "Helped",
  hurt: "Made it worse",
  no_difference: "No real difference",
  off: "Turned off here",
  not_replayed: "Not replayed",
  not_at_level: "Not at this level",
};

function Figures({ s }: { s: StrategySummary }) {
  const cells: [string, string][] = [
    ["Return", formatReturn(s.totalReturn)],
    ["Worst drop", drop(s.worstDrop)],
    ...s.stress.map((x): [string, string] => [`${x.label} drop`, drop(x.fraction)]),
    ["Trades", String(s.trades)],
    ["Cost", formatCents(s.costCents)],
  ];
  return (
    <dl className="grid grid-cols-3 gap-x-3 gap-y-1 sm:grid-cols-6">
      {cells.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-zinc-500">{label}</dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Level({ l, open }: { l: LevelRuleReplay; open: boolean }) {
  const gap = (l.strategies.rules.totalReturn - l.strategies.rebalance.totalReturn) * 100;
  return (
    <details
      open={open}
      data-level={l.level}
      className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
    >
      <summary className="cursor-pointer font-medium">
        {l.label}
        <span className="ml-2 text-xs font-normal text-zinc-500">
          extra rules {points(gap)} against plain rebalancing
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-3 text-sm">
        {STRATEGIES.map((k) => (
          <div key={k} data-strategy={k} className="flex flex-col gap-1">
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {RULE_REPLAY_STRATEGY_LABELS[k]}
            </p>
            <Figures s={l.strategies[k]} />
          </div>
        ))}
        <ul className="flex flex-col gap-1">
          {l.verdicts.map((v) => (
            <li key={v.rule} data-rule={v.rule} data-status={v.status}>
              <span className="font-medium">{v.label}:</span> {STATUS[v.status]}.{" "}
              <span className="text-zinc-600 dark:text-zinc-400">{v.why}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export function RuleReplaySection({ data }: { data: LoadedRuleReplays }) {
  const { replays: r } = data;
  if (r.levels.length === 0) return null;
  const a = r.assumptions;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="rule-replay-heading">
      <div className="flex flex-col gap-1">
        <h2 id="rule-replay-heading" className="text-xl font-semibold">
          Did the extra rules help?
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <strong>{data.label}</strong>, to {longDate(r.to)}: the practice autopilot run day by day
          with its own rules (dip buys, tax-loss swaps and, at High and Very high, news ideas),
          against plain rebalancing and buy and hold. {r.notAForecast}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {r.levels.map((l, i) => (
          <Level key={l.level} l={l} open={i === 0} />
        ))}
      </div>
      <div className="flex flex-col gap-1 text-xs text-zinc-500">
        <p className="font-medium text-zinc-600 dark:text-zinc-400">Assumptions</p>
        <ul className="list-disc pl-5">
          <li>
            {formatCents(a.startCents)} to start and {formatCents(a.monthlyAddCents)} added each
            month, the same for all three.
          </li>
          <li>
            Every cap the live autopilot keeps: per trade, per holding, trades a day and the share
            in opportunity stocks.
          </li>
          <li>
            Each trade costs {(a.tradeCostBps / 100).toFixed(2)}% of what changes hands. No taxes.
          </li>
          <li>
            A rule &ldquo;made it worse&rdquo; when the return was lower, or the worst drop deeper,
            by more than {a.worsePoints} points than the same replay without it; Jane turns those
            off at that level.
          </li>
          {data.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
      <DemoAdviceLabel />
    </section>
  );
}
