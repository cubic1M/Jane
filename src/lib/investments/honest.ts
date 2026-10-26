import { CORE_FUNDS, FUND_FACTS } from "@/config/funds";
import { TARGET_MIXES } from "@/config/investing";
import { HONEST_PERIODS } from "@/config/returns";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { profileSummary } from "@/planning/investor-profile";
import { honestPeriod, type HonestPeriod } from "@/planning/honest";
import { loadLocation } from "./location";
import { loadInvestments, type Investments } from "./holdings";
import { profileOf } from "./profile";
import { loadReturns } from "./returns";
import { DAY_MS } from "@/lib/dates";

// Honest performance (spec step 233), for the investments page, Jane's answers and its
// tool: how the money really did over 1, 3 and 5 years, after fees and taxes, against a
// benchmark mix with the same risk, and why they differ. Facts about the past only.

type Options = { client?: PrismaClient; now?: Date; investments?: Investments };

export type HonestRow = HonestPeriod & {
  key: string;
  label: string;
  from: string;
  to: string;
  // Asked for more history than there is.
  shorter: boolean;
};

export type HonestView = {
  advice: boolean;
  riskLevel: number | null;
  rows: HonestRow[];
  ownFeeBps: number;
  taxDragBps: number;
  simulatedPrices: boolean;
};

export async function loadHonest(
  userId: string,
  { client = defaultClient, now = new Date(), investments: loaded }: Options = {},
): Promise<HonestView> {
  const investments = loaded ?? (await loadInvestments(userId, { client, now }));
  const [advice, answers, location] = await Promise.all([
    adviceMode(userId, { client }),
    profileOf(userId, { client }),
    loadLocation(userId, { client, now, investments }),
  ]);
  const profile = profileSummary(answers, now.toISOString().slice(0, 10));
  const total = investments.accounts.reduce((s, a) => s + a.holdingsCents, 0);
  const held = investments.accounts.flatMap((a) =>
    a.holdings.map((h) => ({
      ...h,
      taxable: location.accounts.find((x) => x.id === a.id)?.kind === "taxable",
    })),
  );
  // Yearly fund costs, from each fund's expense ratio, in basis points of everything held.
  const feeCents = held.reduce((s, h) => s + (h.valueCents * (h.expenseRatioBps ?? 0)) / 10_000, 0);
  const ownFeeBps = total > 0 ? (feeCents / total) * 10_000 : 0;
  // Tax on payouts in taxable accounts: interest at the ordinary rate, dividends at the lower.
  const taxCents = held
    .filter((h) => h.taxable && h.ticker)
    .reduce((s, h) => {
      const f = FUND_FACTS[h.ticker!];
      if (!f?.yieldBps) return s;
      return (
        s +
        h.valueCents *
          (f.yieldBps / 10_000) *
          (f.interest ? location.ordinaryRate : location.gainRate)
      );
    }, 0);
  const taxDragBps = total > 0 ? (taxCents / total) * 10_000 : 0;
  if (!profile.complete) {
    return { advice, riskLevel: null, rows: [], ownFeeBps, taxDragBps, simulatedPrices: false };
  }
  const mix = TARGET_MIXES[profile.riskLevel];
  const returns = await loadReturns(userId, {
    client,
    now,
    investments,
    periods: HONEST_PERIODS,
    benchmark: {
      us_stocks: mix.us_stocks,
      intl_stocks: mix.intl_stocks,
      bonds: mix.bonds,
      cash: mix.cash,
    },
  });
  const benchFeeBps =
    mix.us_stocks * (FUND_FACTS[CORE_FUNDS.us_stocks]?.expenseRatioBps ?? 0) +
    mix.intl_stocks * (FUND_FACTS[CORE_FUNDS.intl_stocks]?.expenseRatioBps ?? 0) +
    mix.bonds * (FUND_FACTS[CORE_FUNDS.bonds]?.expenseRatioBps ?? 0);
  const cashShare =
    total > 0
      ? investments.byAssetClass.find((c) => c.assetClass === "cash")!.valueCents / total
      : 0;
  const rows = returns.periods.flatMap((p): HonestRow[] => {
    if (p.timeWeighted === null || p.benchmark === null) return [];
    const years = Math.max(0.05, (Date.parse(p.to) - Date.parse(p.from)) / (365.25 * DAY_MS));
    const wanted = HONEST_PERIODS.find((x) => x.key === p.key)!;
    return [
      {
        ...honestPeriod({
          years,
          twr: p.timeWeighted,
          mwr: p.moneyWeighted,
          benchmark: p.benchmark,
          ownFeeBps,
          benchFeeBps,
          ownCashShare: cashShare,
          benchCashShare: mix.cash,
          taxDragBps,
        }),
        key: p.key,
        label: p.label,
        from: p.from,
        to: p.to,
        shorter: (Date.parse(p.to) - Date.parse(p.from)) / DAY_MS < wanted.days * 0.97,
      },
    ];
  });
  return {
    advice,
    riskLevel: profile.riskLevel,
    rows,
    ownFeeBps,
    taxDragBps,
    simulatedPrices: returns.simulatedPrices,
  };
}
