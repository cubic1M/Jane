import {
  INTRADAY_RULES,
  INTRADAY_SLIPPAGE,
  INTRADAY_WARNING,
  type IntradayRuleId,
} from "@/config/intraday-strategies";
import { DAY_TRADE_TICKER } from "@/config/portfolios";
import { tradeOf, type Session, type Trade } from "./intraday";
import { formatCents } from "@/lib/money";

// The day-trading sleeve in the practice portfolio (Phase AW, Stage A, Very high only): after the
// close, the rule the person chose is run on the day's own 5-minute bars, exactly as the menu's
// replay runs it (src/planning/intraday.ts): at most one trade, long only, in and out the same
// day, paying INTRADAY_SLIPPAGE each way. Its money is the sleeve's share of the portfolio, kept
// out of the mix as cash. Pure. Practice money only; most day trading loses money.

export type DayTradeSleeve = { rule: IntradayRuleId; param: number; share: number };

export type DayFill = {
  ticker: string;
  side: "buy" | "sell";
  amountCents: number;
  // The fill's own price, from the day's bars with the slippage in.
  priceCents: number;
  reason: string;
  rule: "day_trade";
};

const OUT: Readonly<Record<Trade["reason"], string>> = {
  stop: "at its stop",
  target: "at its target",
  vwap: "back at the day's average price",
  close: "at the close",
};

// The cash the sleeve keeps out of the mix: its share of the portfolio.
export const dayTradeReserve = (sleeve: DayTradeSleeve | null, portfolioCents: number) =>
  sleeve ? Math.round(sleeve.share * portfolioCents) : 0;

export function dayTradeFills(input: {
  sleeve: DayTradeSleeve;
  today: Session | null;
  prior: Session | null;
  portfolioCents: number;
  cashCents: number;
}): DayFill[] {
  const { sleeve, today } = input;
  if (!today) return [];
  const t = tradeOf(sleeve.rule, sleeve.param, today, input.prior);
  if (!t) return [];
  const amount = Math.min(dayTradeReserve(sleeve, input.portfolioCents), input.cashCents);
  if (amount <= 0) return [];
  const buyPrice = Math.round(t.entry * (1 + INTRADAY_SLIPPAGE));
  const sellPrice = Math.round(t.exit * (1 - INTRADAY_SLIPPAGE));
  const back = Math.round((amount * sellPrice) / buyPrice);
  const label = INTRADAY_RULES[sleeve.rule].label;
  const change = back - amount;
  return [
    {
      ticker: DAY_TRADE_TICKER,
      side: "buy",
      amountCents: amount,
      priceCents: buyPrice,
      rule: "day_trade",
      reason: `Day trade (${label}): bought ${formatCents(amount)} of ${DAY_TRADE_TICKER} at ${formatCents(buyPrice)}, as the rule said on today's 5-minute bars.`,
    },
    {
      ticker: DAY_TRADE_TICKER,
      side: "sell",
      amountCents: back,
      priceCents: sellPrice,
      rule: "day_trade",
      reason: `Day trade (${label}): sold at ${formatCents(sellPrice)} ${OUT[t.reason]}, ${change >= 0 ? "up" : "down"} ${formatCents(Math.abs(change))} after slippage. ${INTRADAY_WARNING}`,
    },
  ];
}
