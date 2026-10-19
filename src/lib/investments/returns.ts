import { addDays } from "@/data-sources/demo/demo-bank";
import { CORE_FUNDS, type AssetClass } from "@/config/funds";
import {
  INCOME_SUBTYPES,
  MONEY_IN_SUBTYPES,
  MONEY_OUT_SUBTYPES,
  RETURN_PERIODS,
  type ReturnPeriodKey,
} from "@/config/returns";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  blendedReturn,
  moneyWeightedReturn,
  timeWeightedReturn,
  type DayValue,
  type Flow,
} from "@/insights/returns";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { lastClose, marketDataFor, type MarketDataPartner } from "@/lib/market-data/partner";
import { loadInvestments, type Investments } from "./holdings";

// How the investments have done (spec step 156), for the investments page, Jane's answers
// and her tools. Daily values come from the daily balance snapshots; before the first one,
// from what's held today at the market-data partner's prices (demo bank only, until a real
// provider is connected). Money paid in counts as money in, not as a gain. Facts only.

export type PeriodReturn = {
  key: ReturnPeriodKey;
  label: string;
  from: string;
  to: string;
  startCents: number;
  endCents: number;
  // The investments' own return, and the person's money's.
  timeWeighted: number | null;
  moneyWeighted: number | null;
  // A simple index-fund mix in the same shares as theirs.
  benchmark: number | null;
  paidInCents: number;
  incomeCents: number;
};

export type Returns = {
  asOf: string;
  periods: PeriodReturn[];
  // Whether the prices behind it are the stand-in feed's (made up).
  simulatedPrices: boolean;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

// What's held today, by ticker, with the cash beside it.
function backcaster(investments: Investments, market: MarketDataPartner | null) {
  if (!market) return null;
  const held = investments.accounts.flatMap((a) => a.holdings);
  const cash = held.filter((h) => h.isCash).reduce((s, h) => s + h.valueCents, 0);
  const priced = held.filter((h) => !h.isCash);
  if (priced.some((h) => !h.ticker || market.priceCents(h.ticker, investments.asOf) === null)) {
    return null;
  }
  return (day: string) =>
    cash +
    priced.reduce(
      (s, h) => s + Math.round(h.quantity * (market.priceCents(h.ticker!, day) ?? 0)),
      0,
    );
}

export async function loadReturns(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    investments: loaded,
  }: { client?: PrismaClient; now?: Date; investments?: Investments } = {},
): Promise<Returns> {
  const investments = loaded ?? (await loadInvestments(userId, { client, now }));
  const end = lastClose(now);
  const earliest = addDays(end, -Math.max(...RETURN_PERIODS.map((p) => p.days)));
  const ids = investments.accounts.map((a) => a.id);
  const db = scopedFor(userId, client);
  const [market, snapshots, transactions] = await Promise.all([
    marketDataFor(userId, client),
    ids.length === 0
      ? Promise.resolve([])
      : db.balanceSnapshots.findMany({
          where: { accountId: { in: ids }, date: { gte: new Date(`${earliest}T00:00:00Z`) } },
          select: { accountId: true, date: true, balanceCents: true },
        }),
    ids.length === 0
      ? Promise.resolve([])
      : db.investmentTransactions.findMany({
          where: {
            accountId: { in: ids },
            date: { gt: new Date(`${earliest}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) },
            subtype: { in: [...MONEY_IN_SUBTYPES, ...MONEY_OUT_SUBTYPES, ...INCOME_SUBTYPES] },
          },
          select: { date: true, amountCents: true, subtype: true },
        }),
  ]);

  // A day's value from snapshots, when every account has one that day.
  const byDay = new Map<string, Map<string, number>>();
  for (const s of snapshots) {
    const day = iso(s.date);
    if (!byDay.has(day)) byDay.set(day, new Map());
    byDay.get(day)!.set(s.accountId, s.balanceCents);
  }
  const snapshotValue = (day: string) => {
    const accounts = byDay.get(day);
    if (!accounts || accounts.size < ids.length) return null;
    return [...accounts.values()].reduce((s, v) => s + v, 0);
  };
  const firstSnapshot =
    [...byDay.keys()].filter((d) => snapshotValue(d) !== null).sort()[0] ?? null;
  const backcast = backcaster(investments, market);
  const valueOn = (day: string) => snapshotValue(day) ?? (backcast ? backcast(day) : null);

  // Money in and out counts only where values come from balances (a backcast already
  // holds today's amounts, so it has no flows).
  const flows: Flow[] = transactions
    .filter((t) => MONEY_IN_SUBTYPES.includes(t.subtype) || MONEY_OUT_SUBTYPES.includes(t.subtype))
    .map((t) => ({ day: iso(t.date), amountCents: -t.amountCents }))
    .filter((f) => firstSnapshot !== null && f.day > firstSnapshot);

  const shares = investments.byAssetClass.filter((c) => c.assetClass !== "other");
  const total = shares.reduce((s, c) => s + c.valueCents, 0);

  const periods = RETURN_PERIODS.flatMap((p): PeriodReturn[] => {
    const from = addDays(end, -p.days);
    const values: DayValue[] = [];
    for (let day = from; day <= end; day = addDays(day, 1)) {
      const v = valueOn(day);
      if (v !== null) values.push({ day, valueCents: v });
    }
    if (values.length < 2) return [];
    const inside = flows.filter((f) => f.day > values[0].day && f.day <= end);
    const mwr = moneyWeightedReturn(values[0], inside, values.at(-1)!);
    const benchmark =
      market && total > 0
        ? blendedReturn(
            shares.map((c) => {
              const ticker = CORE_FUNDS[c.assetClass as Exclude<AssetClass, "other">];
              const prices =
                c.assetClass === "cash"
                  ? market
                      .history(CORE_FUNDS.us_stocks, values[0].day, end)
                      .map((x) => ({ day: x.day, valueCents: 100 }))
                  : market
                      .history(ticker, values[0].day, end)
                      .map((x) => ({ day: x.day, valueCents: x.priceCents }));
              return { weight: c.valueCents / total, prices };
            }),
          )
        : null;
    return [
      {
        key: p.key,
        label: p.label,
        from: values[0].day,
        to: end,
        startCents: values[0].valueCents,
        endCents: values.at(-1)!.valueCents,
        timeWeighted: timeWeightedReturn(values, inside),
        moneyWeighted: mwr?.period ?? null,
        benchmark,
        paidInCents: inside.reduce((s, f) => s + f.amountCents, 0),
        incomeCents: transactions
          .filter((t) => INCOME_SUBTYPES.includes(t.subtype) && iso(t.date) > from)
          .reduce((s, t) => s + Math.abs(t.amountCents), 0),
      },
    ];
  });
  return { asOf: end, periods, simulatedPrices: market?.simulated ?? false };
}
