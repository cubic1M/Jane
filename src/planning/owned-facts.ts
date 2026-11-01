import { ASSET_CLASSES, type AssetClass } from "@/config/funds";
import type { InvestmentAccountView } from "@/insights/investments";
import { formatCents } from "@/lib/money";

// What a person owns, as facts only (read-only beta, real accounts): the mix, the share in their
// biggest single stock, what the funds cost in dollars a year and how much is uninvested cash.
// Nothing here says to buy, sell or switch anything, and every figure is the person's own.
// Real accounts get no advice (REAL_ACCOUNT_ADVICE stays false). Pure.

export type OwnedFacts = {
  totalCents: number;
  mix: { assetClass: AssetClass; label: string; valueCents: number; share: number }[];
  biggestStock: { ticker: string | null; name: string; valueCents: number; share: number } | null;
  fees: {
    yearlyCents: number;
    // Holdings whose yearly cost Jane knows, and those she doesn't.
    knownCents: number;
    unknownCents: number;
    unknownNames: string[];
    top: { name: string; yearlyCents: number } | null;
  };
  cash: { cents: number; share: number };
  sentences: string[];
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function ownedFacts(accounts: readonly InvestmentAccountView[]): OwnedFacts | null {
  const holdings = accounts.flatMap((a) => a.holdings);
  const total = holdings.reduce((s, h) => s + h.valueCents, 0);
  if (total <= 0) return null;

  const byClass = new Map<AssetClass, number>();
  for (const h of holdings) {
    for (const [c, share] of Object.entries(h.mix) as [AssetClass, number][]) {
      byClass.set(c, (byClass.get(c) ?? 0) + h.valueCents * share);
    }
  }
  const mix = (Object.keys(ASSET_CLASSES) as AssetClass[])
    .map((assetClass) => ({
      assetClass,
      label: ASSET_CLASSES[assetClass],
      valueCents: Math.round(byClass.get(assetClass) ?? 0),
      share: (byClass.get(assetClass) ?? 0) / total,
    }))
    .filter((m) => m.valueCents > 0)
    .sort((a, b) => b.valueCents - a.valueCents);

  const stocks = holdings
    .filter((h) => h.type === "equity" && !h.isCash)
    .sort((a, b) => b.valueCents - a.valueCents);
  const biggest = stocks[0];
  const biggestStock = biggest
    ? {
        ticker: biggest.ticker,
        name: biggest.name,
        valueCents: biggest.valueCents,
        share: biggest.valueCents / total,
      }
    : null;

  const priced = holdings.filter((h) => !h.isCash);
  const known = priced.filter((h) => h.expenseRatioBps !== null);
  const yearly = (h: { valueCents: number; expenseRatioBps: number | null }) =>
    Math.round((h.valueCents * (h.expenseRatioBps ?? 0)) / 10_000);
  const knownCents = known.reduce((s, h) => s + h.valueCents, 0);
  const unknown = priced.filter((h) => h.expenseRatioBps === null && h.type !== "equity");
  const topFund = [...known].sort((a, b) => yearly(b) - yearly(a))[0];
  const fees = {
    yearlyCents: known.reduce((s, h) => s + yearly(h), 0),
    knownCents,
    unknownCents: unknown.reduce((s, h) => s + h.valueCents, 0),
    unknownNames: unknown.map((h) => h.ticker ?? h.name),
    top:
      topFund && yearly(topFund) > 0
        ? { name: topFund.ticker ?? topFund.name, yearlyCents: yearly(topFund) }
        : null,
  };

  const cashCents = holdings.filter((h) => h.isCash).reduce((s, h) => s + h.valueCents, 0);
  const cash = { cents: cashCents, share: cashCents / total };

  const sentences: string[] = [];
  // "Bonds" reads "bonds" mid-sentence; "US stocks" stays "US" (night QA 10-30: "50% us stocks").
  const inSentence = (label: string) => label.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase());
  // "Other" that is only funds the table doesn't know is said as such, by name, after the rest
  // (debugger 11-01: "50% other" was a target-date fund and a stock fund).
  const unseen = holdings.filter(
    (h) => !h.isCash && h.type !== "equity" && h.expenseRatioBps === null && (h.mix.other ?? 0) > 0,
  );
  const otherCents = byClass.get("other") ?? 0;
  const unseenCents = unseen.reduce((s, h) => s + h.valueCents * (h.mix.other ?? 0), 0);
  const onlyUnseen = unseen.length > 0 && Math.abs(otherCents - unseenCents) < 1;
  const parts = onlyUnseen
    ? [
        ...mix
          .filter((m) => m.assetClass !== "other")
          .map((m) => `${pct(m.share)} ${inSentence(m.label)}`),
        `${pct(otherCents / total)} in funds whose mix I don't know (${unseen
          .slice(0, 4)
          .map((h) => h.ticker ?? h.name)
          .join(", ")}${unseen.length > 4 ? " and others" : ""})`,
      ]
    : mix.map((m) => `${pct(m.share)} ${inSentence(m.label)}`);
  sentences.push(`You own ${formatCents(total)}: ${parts.join(", ")}.`);
  if (biggestStock) {
    sentences.push(
      `Your largest single stock is ${biggestStock.name}${biggestStock.ticker ? ` (${biggestStock.ticker})` : ""}, ${formatCents(biggestStock.valueCents)}, which is ${pct(biggestStock.share)} of everything you own.`,
    );
  }
  if (known.length > 0) {
    sentences.push(
      `The funds you hold cost about ${formatCents(fees.yearlyCents)} a year in fees${fees.top ? `, mostly ${fees.top.name} at ${formatCents(fees.top.yearlyCents)}` : ""}.`,
    );
  }
  if (fees.unknownNames.length > 0) {
    sentences.push(
      `I don't know the yearly cost of ${fees.unknownNames.slice(0, 4).join(", ")}${fees.unknownNames.length > 4 ? " and others" : ""}, so ${fees.unknownNames.length === 1 ? "it's" : "they're"} not in that total.`,
    );
  }
  if (cashCents > 0) {
    sentences.push(`${formatCents(cashCents)} (${pct(cash.share)}) is uninvested cash.`);
  }
  return { totalCents: total, mix, biggestStock, fees, cash, sentences };
}
