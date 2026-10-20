import {
  CASH_REAL_GROWTH,
  DEFAULT_INVEST_SHARE_OF_MARGIN,
  GROWING_ASSET_KINDS,
  HOME_REAL_GROWTH,
  LEVER_MONTHLY_CENTS,
  MAX_EXTRA_MONTHLY_CENTS,
  MAX_RETURN,
} from "@/config/long-view";
import { INFLATION, RETURN_HIGH, RETURN_LOW } from "@/config/market-assumptions";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadDetectionInput } from "@/detection/engine";
import type { DetectionInput } from "@/detection/types";
import { netWorth } from "@/insights/net-worth";
import { adviceMode } from "@/lib/advice-mode";
import { cryptoTotal } from "@/lib/crypto/crypto";
import { loadPayoff } from "@/lib/debt-plan";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { healthInput } from "@/lib/health-score";
import { loadRetirement } from "@/lib/investments/retirement";
import {
  levers,
  longView,
  type Horizon,
  type Lever,
  type LongViewInput,
  type Rates,
} from "@/planning/long-view";
import type { RetirementPlan } from "@/planning/retirement";

// The long view (spec step 209): net worth in 10, 20 and 30 years from the person's real
// balances, debts and margin, as a range, in today's dollars. The investment and inflation
// rates are the investment pages' own; the others are in src/config/long-view.ts. Every
// assumption is returned so the page can show it, and the person can change them. For
// demo-advice people it also says what moves it most and whether retirement is on track;
// real accounts get the projection and its assumptions, with no advice.

type Options = { client?: PrismaClient; now?: Date; input?: DetectionInput };

export type Overrides = { investedLow?: number; investedHigh?: number; extraMonthlyCents?: number };

export type LongView = {
  horizons: Horizon[];
  assumptions: { label: string; value: string; source: string; editable?: string }[];
  rates: Rates;
  // Only with demo advice.
  advice: boolean;
  levers: (Lever & { href: string; words: string })[];
  retirement: RetirementPlan | null;
};

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

// Growth after inflation.
const real = (nominal: number) => (1 + nominal) / (1 + INFLATION.value) - 1;

export function cleanOverrides(raw: { low?: unknown; high?: unknown; extra?: unknown }): Overrides {
  const rate = (v: unknown) => {
    const n = typeof v === "string" || typeof v === "number" ? Number(v) / 100 : NaN;
    return Number.isFinite(n) && n >= 0 && n <= MAX_RETURN ? n : undefined;
  };
  const extra = Number(raw.extra);
  return {
    investedLow: rate(raw.low),
    investedHigh: rate(raw.high),
    extraMonthlyCents:
      Number.isFinite(extra) && extra > 0
        ? Math.min(MAX_EXTRA_MONTHLY_CENTS, Math.round(extra * 100))
        : undefined,
  };
}

export async function loadLongView(
  userId: string,
  overrides: Overrides = {},
  { client = defaultClient, now = new Date(), input: given }: Options = {},
): Promise<LongView | null> {
  const input = given ?? (await loadDetectionInput(userId, { client, now }));
  if (input.accounts.length === 0) return null;
  const db = scopedFor(userId, client);
  const [accounts, ownedRows, crypto, payoff, health, auto, advice] = await Promise.all([
    db.accounts.findMany({
      select: { id: true, name: true, type: true, currentBalanceCents: true },
    }),
    db.ownedAssets.findMany({ select: { id: true, kind: true, valueCents: true, valuedOn: true } }),
    cryptoTotal(userId, { client }),
    loadPayoff(userId, { client, now }),
    healthInput(userId, input, { client, now }),
    db.autoInvestPlans.findFirst({ where: { status: "active" }, select: { amountCents: true } }),
    adviceMode(userId, { client }),
  ]);
  const owned = ownedRows.map((o) => ({
    id: o.id,
    valueCents: o.valueCents,
    valuedOn: o.valuedOn.toISOString().slice(0, 10),
  }));
  const worth = netWorth(
    accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })),
    owned,
    crypto,
  );
  const growing = ownedRows
    .filter((o) => GROWING_ASSET_KINDS.includes(o.kind))
    .reduce((s, o) => s + o.valueCents, 0);
  const cash = accounts
    .filter((a) => a.type === "depository")
    .reduce((s, a) => s + (a.currentBalanceCents ?? 0), 0);

  const margin = Math.max(0, (health.monthlyIncomeCents ?? 0) - (health.monthlySpendingCents ?? 0));
  const autoMonthly = (auto?.amountCents ?? 0) * 2;
  const investMonthly =
    autoMonthly > 0 ? autoMonthly : Math.round(margin * DEFAULT_INVEST_SHARE_OF_MARGIN);

  const data: LongViewInput = {
    cashCents: cash,
    investedCents: worth.investmentsCents + crypto,
    growingAssetsCents: growing,
    otherAssetsCents: worth.ownedCents - growing,
    debts: payoff.book.debts
      .filter((d) => (d.balanceCents ?? 0) > 0)
      .map((d) => ({
        name: d.name,
        balanceCents: d.balanceCents ?? 0,
        aprBps: d.aprBps ?? 0,
        paymentCents:
          d.paymentCents === null
            ? null
            : d.paymentEvery === "two_weeks"
              ? d.paymentCents * 2
              : d.paymentCents,
        fromMargin: d.kind === "card" || d.kind === "bnpl",
      })),
    marginCents: margin,
    investMonthlyCents: investMonthly,
  };
  const lowNominal = overrides.investedLow ?? RETURN_LOW.value;
  const highNominal = Math.max(lowNominal, overrides.investedHigh ?? RETURN_HIGH.value);
  const rates: Rates = {
    investedLow: real(lowNominal),
    investedHigh: real(highNominal),
    cash: CASH_REAL_GROWTH,
    home: HOME_REAL_GROWTH,
  };
  const extra = overrides.extraMonthlyCents ?? 0;
  const horizons = longView(data, rates, extra);

  const assumptions = [
    {
      label: "Low yearly return",
      value: pct(lowNominal),
      source: RETURN_LOW.source,
      editable: "low",
    },
    {
      label: "High yearly return",
      value: pct(highNominal),
      source: RETURN_HIGH.source,
      editable: "high",
    },
    { label: "Inflation", value: pct(INFLATION.value), source: INFLATION.source },
    {
      label: "Home values (after inflation)",
      value: pct(HOME_REAL_GROWTH),
      source: "Long-run US house prices have risen about 1% a year faster than prices",
    },
    {
      label: "Cash (after inflation)",
      value: pct(CASH_REAL_GROWTH),
      source: "Savings roughly keep pace with inflation",
    },
    {
      label: "Extra invested each month",
      value: `${extra / 100}`,
      source: "Yours to set",
      editable: "extra",
    },
    {
      label: "Saved each month",
      value: `${Math.round(margin / 100)} (income less spending); ${Math.round(investMonthly / 100)} of it invested`,
      source: "Your last three full months",
    },
  ];

  const leverRows = advice
    ? levers(data, rates, LEVER_MONTHLY_CENTS).map((l) => ({
        ...l,
        href: l.key === "invest" ? "/investments/auto" : "/debt",
        words:
          l.key === "invest"
            ? `Investing ${LEVER_MONTHLY_CENTS / 100} more a month`
            : `Paying ${LEVER_MONTHLY_CENTS / 100} more a month toward ${l.label}`,
      }))
    : [];
  const retirement = advice
    ? ((await loadRetirement(userId, { client, now })).retirement ?? null)
    : null;
  return { horizons, assumptions, rates, advice, levers: leverRows, retirement };
}
