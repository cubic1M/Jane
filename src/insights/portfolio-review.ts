import { MIN_ORDER_CENTS } from "@/config/brokerage";
import { ASSET_CLASSES, CORE_FUNDS, FUND_NAMES, type AssetClass } from "@/config/funds";
import {
  CASH_DRAG_POINTS,
  DRIFT_POINTS,
  MIN_MOVE_CENTS,
  RISK_LEVELS,
  SINGLE_STOCK_LIMIT,
  TARGET_MIXES,
  type RiskLevel,
} from "@/config/investing";
import type { HoldingView, InvestmentAccountView } from "./investments";
import { formatPercent as pct } from "@/lib/percent";

// Does it fit? (spec step 131, demo advice). The person's mix of investments against the
// target for their risk level (src/config/investing.ts), any one company's shares that are
// too big a part of it (more so their employer's), and cash above the target mix; then what to
// change and why, in plain words. Pure. Never says what returns will be: only how the mix
// compares with the target their own answers chose.

export type MixRow = {
  assetClass: AssetClass;
  label: string;
  valueCents: number;
  share: number;
  targetShare: number;
  // Positive: buy this much; negative: sell this much, to reach the target.
  changeCents: number;
  offTarget: boolean;
};

export type Concentration = {
  holding: HoldingView;
  accountName: string;
  share: number;
  // The person's employer, seen in their pay.
  employer: boolean;
  // Selling this much brings it back to the limit.
  overCents: number;
};

export type Recommendation = {
  kind: "rebalance" | "concentration" | "cash";
  // How much it moves.
  amountCents: number;
  what: string;
  why: string;
};

export type PortfolioReview = {
  riskLevel: RiskLevel;
  riskLabel: string;
  totalCents: number;
  mix: MixRow[];
  offTarget: boolean;
  concentrated: Concentration[];
  cashAboveTargetCents: number;
  recommendations: Recommendation[];
  // Accounts whose balance is known but not what's in it: left out of the mix.
  leftOut: string[];
};

// "US stocks" stays capitalised; "Bonds" becomes "bonds".
export const classWords = (label: string) =>
  label.startsWith("US") ? label : label.charAt(0).toLowerCase() + label.slice(1);
const dollars = (cents: number) => `$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;

// The first word of a company's name, for spotting it in a paycheck ("Acme Corp" in
// "ACME CORP PAYROLL").
const firstWord = (name: string) => name.split(/[\s,.]+/)[0]?.toLowerCase() ?? "";

export function isEmployer(holding: HoldingView, payNames: readonly string[]): boolean {
  const word = firstWord(holding.name);
  return word.length >= 3 && payNames.some((p) => p.toLowerCase().split(/\W+/).includes(word));
}

export function reviewPortfolio(
  accounts: InvestmentAccountView[],
  riskLevel: RiskLevel,
  // Who pays the person (their income transactions' names), to spot employer shares.
  payNames: readonly string[] = [],
): PortfolioReview {
  const target = TARGET_MIXES[riskLevel];
  const values = new Map<AssetClass, number>();
  let total = 0;
  for (const h of accounts.flatMap((a) => a.holdings)) {
    total += h.valueCents;
    for (const [assetClass, share] of Object.entries(h.mix) as [AssetClass, number][]) {
      values.set(assetClass, (values.get(assetClass) ?? 0) + h.valueCents * share);
    }
  }
  const classes = (Object.keys(ASSET_CLASSES) as AssetClass[]).filter(
    (c) => c in target || (values.get(c) ?? 0) > 0,
  );
  const mix = classes.map((assetClass): MixRow => {
    const valueCents = Math.round(values.get(assetClass) ?? 0);
    const share = total > 0 ? valueCents / total : 0;
    const targetShare = target[assetClass as keyof typeof target] ?? 0;
    return {
      assetClass,
      label: ASSET_CLASSES[assetClass],
      valueCents,
      share,
      targetShare,
      changeCents: Math.round(total * targetShare) - valueCents,
      offTarget: Math.abs(share - targetShare) * 100 >= DRIFT_POINTS,
    };
  });

  const concentrated: Concentration[] = [];
  for (const account of accounts) {
    for (const h of account.holdings) {
      if (h.type !== "equity" || total === 0) continue;
      const share = h.valueCents / total;
      const overCents = h.valueCents - Math.round(total * SINGLE_STOCK_LIMIT);
      // Only when it's worth a trade.
      if (share <= SINGLE_STOCK_LIMIT || overCents < MIN_MOVE_CENTS) continue;
      concentrated.push({
        holding: h,
        accountName: account.name,
        share,
        employer: isEmployer(h, payNames),
        overCents,
      });
    }
  }

  const cash = mix.find((m) => m.assetClass === "cash");
  const cashAboveTargetCents =
    cash && (cash.share - cash.targetShare) * 100 >= CASH_DRAG_POINTS ? -cash.changeCents : 0;

  const label = RISK_LEVELS[riskLevel].label;
  const recommendations: Recommendation[] = [];
  const offTarget = mix.some((m) => m.offTarget);
  if (offTarget) {
    // Each class's move as small as an order the rebalance would place; the whole move worth
    // making (MIN_MOVE_CENTS), as the rebalance plan trades it.
    const moves = mix
      .filter((m) => Math.abs(m.changeCents) >= MIN_ORDER_CENTS && m.assetClass !== "other")
      .sort((a, b) => a.changeCents - b.changeCents);
    const sells = moves.filter((m) => m.changeCents < 0);
    const buys = moves.filter((m) => m.changeCents > 0);
    const worst = [...mix].sort(
      (a, b) => Math.abs(b.share - b.targetShare) - Math.abs(a.share - a.targetShare),
    )[0];
    const moving = sells.reduce((s, m) => s - m.changeCents, 0);
    if (sells.length > 0 && buys.length > 0 && moving >= MIN_MOVE_CENTS) {
      const funds = buys.flatMap((m) => {
        const ticker = CORE_FUNDS[m.assetClass as keyof typeof CORE_FUNDS];
        return ticker ? [`${FUND_NAMES[ticker]} for ${classWords(m.label)}`] : [];
      });
      const moved = sells.reduce((s, m) => s - m.changeCents, 0);
      recommendations.push({
        kind: "rebalance",
        amountCents: moved,
        what: `Move about ${dollars(moved)} from ${listWords(sells.map((m) => classWords(m.label)))} into ${listWords(buys.map((m) => classWords(m.label)))}${funds.length > 0 ? `, using low-cost index funds: ${listWords(funds)}` : ""}.`,
        why: `Your ${label.toLowerCase()} profile aims for ${mixWords(target)}. You have ${pct(worst.share)} in ${classWords(worst.label)} against a target of ${pct(worst.targetShare)}.`,
      });
    }
  }
  for (const c of concentrated) {
    recommendations.push({
      kind: "concentration",
      amountCents: c.overCents,
      what: `Sell about ${dollars(c.overCents)} of ${c.holding.name} to bring it to ${pct(SINGLE_STOCK_LIMIT)} of your investments, and put it into a broad fund.`,
      why: c.employer
        ? `It's ${pct(c.share)} of everything you've invested, and it's where you work: if ${c.holding.name} has a bad year, your job and your savings are hit at once.`
        : `It's ${pct(c.share)} of everything you've invested: one company's bad year would hit your savings hard.`,
    });
  }
  if (cashAboveTargetCents >= MIN_MOVE_CENTS) {
    recommendations.push({
      kind: "cash",
      amountCents: cashAboveTargetCents,
      what: `Invest about ${dollars(cashAboveTargetCents)} of the cash in your investment accounts.`,
      why: `Cash is ${pct(cash!.share)} of your investments against a target of ${pct(cash!.targetShare)}; over long periods cash has usually grown less than a mix of stocks and bonds.`,
    });
  }
  return {
    riskLevel,
    riskLabel: label,
    totalCents: total,
    mix,
    offTarget,
    concentrated,
    cashAboveTargetCents,
    recommendations,
    leftOut: accounts.filter((a) => a.holdings.length === 0).map((a) => a.name),
  };
}

// "a, b and c".
export const listWords = (parts: string[]) =>
  parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;

// "40% US stocks, 20% international stocks, 35% bonds and 5% cash".
export function mixWords(target: Partial<Record<AssetClass, number>>): string {
  return listWords(
    (Object.entries(target) as [AssetClass, number][])
      .filter(([, share]) => share > 0)
      .map(([c, share]) => `${pct(share)} ${classWords(ASSET_CLASSES[c])}`),
  );
}
