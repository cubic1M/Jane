import type { RiskLevel } from "@/config/investing";
import {
  CRYPTO_ASSETS,
  CRYPTO_NAMES,
  CRYPTO_SLEEVE_BY_LEVEL,
  CRYPTO_SLEEVE_MIN_TRADE_CENTS,
  CRYPTO_STRATEGIES,
  type CryptoAsset,
  type CryptoStrategyId,
} from "@/config/crypto-strategies";
import { CRYPTO_PRACTICE_TICKERS } from "@/config/portfolios";
import { cryptoWeights } from "./crypto-strategies";
import {
  portfolioValue,
  positionValue,
  type PlannedTrade,
  type Prices,
} from "./practice-autopilot";
import type { LedgerState } from "./practice-ledger";
import { formatCents } from "@/lib/money";

// The crypto sleeve in the practice portfolio (Phase AW, Stage A, Very high only): the same rule
// the strategy menu replays (src/planning/crypto-strategies.ts), deciding on the same days (each
// week's first trading day; held, each month's), from the closes before the day, on up to the
// sleeve's share of the whole portfolio. It sits beside the mix, outside it, as a news theme's
// slice does. Off, or below Very high, whatever it holds is sold. Pure. Practice money only.

export type Sleeve = { strategy: CryptoStrategyId; param: number; share: number };

const weekOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  // The Monday of its week.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

// The weekday before a day (the live run's last trading day, near enough: a holiday's run reads
// the last close as every run does).
export function previousWeekday(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

// Cash the sleeve's trades free (sells) less what they spend (buys).
export const sleeveCash = (trades: readonly PlannedTrade[]) =>
  trades.reduce((s, t) => s + (t.side === "sell" ? t.amountCents : -t.amountCents), 0);

// Whether the rule decides today: the first trading day of a new week (held: of a new month).
export function sleeveDecides(
  strategy: CryptoStrategyId,
  today: string,
  previous: string | null,
): boolean {
  if (previous === null) return true;
  return strategy === "crypto_hold"
    ? today.slice(0, 7) !== previous.slice(0, 7)
    : weekOf(today) !== weekOf(previous);
}

// Why the rule holds a coin this week, or doesn't, in a few words.
function why(s: Sleeve, coin: CryptoAsset, w: Record<CryptoAsset, number>): string {
  const name = CRYPTO_NAMES[coin];
  if (s.strategy === "crypto_hold") return "half and half, rebalanced each month";
  if (s.strategy === "crypto_trend")
    return w[coin] > 0
      ? `${name} is above its ${s.param}-day average`
      : `${name} is below its ${s.param}-day average`;
  const best = CRYPTO_ASSETS.find((a) => w[a] > 0);
  return best
    ? `${CRYPTO_NAMES[best]} rose more over the last ${s.param} days`
    : `neither coin rose over the last ${s.param} days`;
}

export function cryptoSleeveTrades(input: {
  sleeve: Sleeve | null;
  // The portfolio's level: below Very high the sleeve doesn't run.
  level: RiskLevel;
  state: LedgerState;
  prices: Prices;
  // Each coin's daily closes before today, oldest first, by its ledger ticker.
  history: Readonly<Record<string, readonly number[]>>;
  today: string;
  // The last trading day before today, or null on the first run.
  previous: string | null;
  // The cash the sleeve may use (above the cash kept).
  cashCents: number;
  // Whether the sleeve has traded before: until then it decides every day it runs.
  traded: boolean;
}): PlannedTrade[] {
  const { sleeve, state, prices } = input;
  const held = (coin: CryptoAsset) => positionValue(state, prices, CRYPTO_PRACTICE_TICKERS[coin]);
  if (!sleeve) {
    return CRYPTO_ASSETS.filter((c) => held(c) > 0 && prices[CRYPTO_PRACTICE_TICKERS[c]]).map(
      (c) => ({
        ticker: CRYPTO_PRACTICE_TICKERS[c],
        side: "sell",
        amountCents: held(c),
        rule: "crypto_sleeve",
        reason: `Sold the ${CRYPTO_NAMES[c]}: ${
          CRYPTO_SLEEVE_BY_LEVEL[input.level] === undefined
            ? "the crypto sleeve runs at Very high only"
            : "the crypto sleeve is off"
        }.`,
      }),
    );
  }
  // It starts the first day it runs (before its first trade), then decides on its own days.
  if (input.traded && !sleeveDecides(sleeve.strategy, input.today, input.previous)) return [];
  if (CRYPTO_ASSETS.some((c) => !prices[CRYPTO_PRACTICE_TICKERS[c]])) return [];
  const closes = Object.fromEntries(
    CRYPTO_ASSETS.map((c) => [c, [...(input.history[CRYPTO_PRACTICE_TICKERS[c]] ?? [])]]),
  ) as Record<CryptoAsset, number[]>;
  const t = Math.min(...CRYPTO_ASSETS.map((c) => closes[c].length));
  // The rule needs its look-back of closes before it can decide.
  if (sleeve.strategy !== "crypto_hold" && t < sleeve.param + 2) return [];
  const aligned = Object.fromEntries(CRYPTO_ASSETS.map((c) => [c, closes[c].slice(-t)])) as Record<
    CryptoAsset,
    number[]
  >;
  const w = cryptoWeights(sleeve.strategy, sleeve.param, { dates: [], closes: aligned }, t);
  const total = portfolioValue(state, prices);
  const label = CRYPTO_STRATEGIES[sleeve.strategy].label;
  const moves = CRYPTO_ASSETS.map((c) => ({
    c,
    gap: Math.round(sleeve.share * w[c] * total) - held(c),
  })).filter((m) => Math.abs(m.gap) >= CRYPTO_SLEEVE_MIN_TRADE_CENTS);
  const out: PlannedTrade[] = [];
  let cash = input.cashCents;
  for (const m of moves.filter((x) => x.gap < 0)) {
    out.push({
      ticker: CRYPTO_PRACTICE_TICKERS[m.c],
      side: "sell",
      amountCents: -m.gap,
      rule: "crypto_sleeve",
      reason: `Sold ${formatCents(-m.gap)} of ${CRYPTO_NAMES[m.c]} for the crypto sleeve (${label}): ${why(sleeve, m.c, w)}.`,
    });
    cash += -m.gap;
  }
  for (const m of moves.filter((x) => x.gap > 0)) {
    const amount = Math.min(m.gap, cash);
    if (amount < CRYPTO_SLEEVE_MIN_TRADE_CENTS) continue;
    out.push({
      ticker: CRYPTO_PRACTICE_TICKERS[m.c],
      side: "buy",
      amountCents: amount,
      rule: "crypto_sleeve",
      reason: `Bought ${formatCents(amount)} of ${CRYPTO_NAMES[m.c]} for the crypto sleeve (${label}): ${why(sleeve, m.c, w)}. Practice money; crypto can fall 70% or more.`,
    });
    cash -= amount;
  }
  return out;
}
