import {
  usePracticeCrypto,
  usePracticeDayTrading,
  usePracticeStrategy,
} from "@/app/investments/strategy-actions";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { CRYPTO_EVIDENCE, CRYPTO_EVIDENCE_SOURCE } from "@/config/crypto-evidence";
import {
  CRYPTO_SLEEVE_BY_LEVEL,
  CRYPTO_STRATEGIES,
  CRYPTO_STRATEGY_IDS,
  CRYPTO_WARNING,
  type CryptoStrategyId,
} from "@/config/crypto-strategies";
import { INTRADAY_EVIDENCE, INTRADAY_EVIDENCE_SOURCE } from "@/config/intraday-evidence";
import {
  INTRADAY_RULE_IDS,
  INTRADAY_RULES,
  INTRADAY_SLEEVE_BY_LEVEL,
  INTRADAY_WARNING,
  type IntradayRuleId,
} from "@/config/intraday-strategies";
import { STRATEGY_CHOICES, type StrategyChoice } from "@/config/practice-preferences";
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

const BUTTON = "h-9 self-start rounded-lg px-3 text-sm font-medium";
const PRIMARY = `${BUTTON} bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300`;
const SECONDARY = `${BUTTON} border border-zinc-300 dark:border-zinc-700`;

// Crypto, at Very high only: each rule on the years since its parameters were chosen, against
// simply holding, with the plain warning.
function CryptoMenu({ level, chosen }: { level: RiskLevel; chosen: CryptoStrategyId | null }) {
  const open = CRYPTO_SLEEVE_BY_LEVEL[level] !== undefined;
  return (
    <div className="flex flex-col gap-2" aria-labelledby="crypto-menu-heading">
      <h3 id="crypto-menu-heading" className="font-semibold">
        Crypto (Very high only)
      </h3>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        A small sleeve, {Math.round((CRYPTO_SLEEVE_BY_LEVEL[5] ?? 0) * 100)}% of the portfolio at
        most. Each rule&apos;s setting was chosen on 2018 to 2021, then replayed from 2022 after
        fees and slippage, against simply holding. {CRYPTO_WARNING}
      </p>
      <ul className="grid gap-2 sm:grid-cols-3">
        {CRYPTO_STRATEGY_IDS.map((id) => {
          const s = CRYPTO_STRATEGIES[id];
          const r = CRYPTO_EVIDENCE[id];
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
                  label={`${s.label}: $100 became $${(r.curve.at(-1) ?? 100).toFixed(0)} since 2022`}
                />
              </div>
              <p className="text-zinc-600 dark:text-zinc-400">{s.line}</p>
              <p className="text-xs text-zinc-500">
                Since 2022: {pct(r.later.cagr)} a year, worst drop {pct(r.later.maxDrawdown)}
                {id === "crypto_hold"
                  ? "."
                  : ` (holding: ${pct(r.holdLater.cagr)}, worst ${pct(r.holdLater.maxDrawdown)}). ${r.beatsHolding ? "More return for its risk than holding." : "Less return for its risk than holding."}`}
              </p>
              {!open ? (
                <p className="text-xs text-zinc-500">
                  In the practice portfolio at Very high only.
                </p>
              ) : chosen === id ? (
                <form action={usePracticeCrypto} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                    <span aria-hidden="true">■ </span>
                    Your practice portfolio runs this sleeve
                  </span>
                  <input type="hidden" name="sleeve" value="off" />
                  <button type="submit" className={SECONDARY}>
                    Turn the sleeve off
                  </button>
                </form>
              ) : (
                <form action={usePracticeCrypto}>
                  <input type="hidden" name="sleeve" value={id} />
                  <button type="submit" className={PRIMARY}>
                    Use in practice
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Day trading, at Very high only: each rule on the sessions since its setting was chosen, after
// slippage, against holding the fund, with the plain warning first.
function IntradayMenu({ level, chosen }: { level: RiskLevel; chosen: IntradayRuleId | null }) {
  const open = INTRADAY_SLEEVE_BY_LEVEL[level] !== undefined;
  return (
    <div className="flex flex-col gap-2" aria-labelledby="intraday-menu-heading">
      <h3 id="intraday-menu-heading" className="font-semibold">
        Day trading (Very high only)
      </h3>
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        <span aria-hidden="true">▲ </span>
        {INTRADAY_WARNING}
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        A small sleeve, {Math.round((INTRADAY_SLEEVE_BY_LEVEL[5] ?? 0) * 100)}% of the portfolio at
        most, in and out of the S&amp;P 500 fund (SPY) the same day. Each rule&apos;s setting was
        chosen on 2016 to 2023, then replayed from 2024 on 5-minute bars after slippage, against
        simply holding.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {INTRADAY_RULE_IDS.map((id) => {
          const s = INTRADAY_RULES[id];
          const r = INTRADAY_EVIDENCE[id];
          return (
            <li
              key={id}
              data-strategy={id}
              data-family="intraday"
              className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{s.label}</p>
                <Sparkline
                  points={r.curve}
                  label={`${s.label}: $100 became $${(r.curve.at(-1) ?? 100).toFixed(0)} since 2024`}
                />
              </div>
              <p className="text-zinc-600 dark:text-zinc-400">{s.line}</p>
              <p className="text-xs text-zinc-500">
                Since 2024: {pct(r.later.cagr)} a year, worst drop {pct(r.later.maxDrawdown)},{" "}
                {r.later.trades} trades, {pct(r.later.winRate)} won (holding:{" "}
                {pct(r.holdLater.cagr)} a year, worst {pct(r.holdLater.maxDrawdown)}).{" "}
                {r.beatsHolding
                  ? "More return for its risk than holding."
                  : "Less return for its risk than holding."}
              </p>
              {!open ? (
                <p className="text-xs text-zinc-500">
                  In the practice portfolio at Very high only.
                </p>
              ) : chosen === id ? (
                <form action={usePracticeDayTrading} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                    <span aria-hidden="true">■ </span>
                    Your practice portfolio day trades with this
                  </span>
                  <input type="hidden" name="rule" value="off" />
                  <button type="submit" className={SECONDARY}>
                    Stop day trading
                  </button>
                </form>
              ) : (
                <form action={usePracticeDayTrading}>
                  <input type="hidden" name="rule" value={id} />
                  <button type="submit" className={PRIMARY}>
                    Use in practice
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const followable = (id: MenuStrategyId): id is MenuStrategyId & StrategyChoice =>
  Object.hasOwn(STRATEGY_CHOICES, id);

export function StrategyMenuSection({
  level,
  choice,
  crypto = null,
  dayTrading = null,
}: {
  level: RiskLevel;
  // The practice portfolio's strategy now (its settings).
  choice: StrategyChoice;
  // The crypto sleeve it runs (Very high only), or null.
  crypto?: CryptoStrategyId | null;
  // The day-trading rule it follows (Very high only), or null.
  dayTrading?: IntradayRuleId | null;
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="strategy-menu-heading">
      <div className="flex flex-col gap-1">
        <h2 id="strategy-menu-heading" className="text-xl font-semibold">
          More strategies
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Your practice portfolio follows{" "}
          {choice === "level"
            ? `Jane's pick for ${RISK_LEVELS[level].label}`
            : STRATEGY_CHOICES[choice].label}
          . These are other well-known ways to run it, each replayed on real prices from{" "}
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
              {!followable(id) ? (
                <p className="text-xs text-zinc-500">
                  Not in the practice portfolio yet: it holds funds the practice portfolio
                  can&apos;t.
                </p>
              ) : choice === id ? (
                <form action={usePracticeStrategy} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                    <span aria-hidden="true">■ </span>
                    Your practice portfolio uses this
                  </span>
                  <input type="hidden" name="strategy" value="level" />
                  <button type="submit" className={SECONDARY}>
                    Back to Jane&apos;s pick
                  </button>
                </form>
              ) : (
                <form action={usePracticeStrategy}>
                  <input type="hidden" name="strategy" value={id} />
                  <button type="submit" className={PRIMARY}>
                    Use in practice
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      <CryptoMenu level={level} chosen={crypto} />
      <IntradayMenu level={level} chosen={dayTrading} />
      <p className="text-xs text-zinc-500">
        {MENU_EVIDENCE_SOURCE}; crypto: {CRYPTO_EVIDENCE_SOURCE}; day trading:{" "}
        {INTRADAY_EVIDENCE_SOURCE}. {STRATEGY_NOT_A_FORECAST} Practice money only.
      </p>
      <DemoAdviceLabel />
    </section>
  );
}
