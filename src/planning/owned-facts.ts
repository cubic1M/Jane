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
    // Holdings whose yearly cost Jane knows, and those it doesn't.
    knownCents: number;
    unknownCents: number;
    unknownNames: string[];
    top: { name: string; yearlyCents: number } | null;
  };
  cash: { cents: number; share: number };
  sentences: string[];
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

// Only a fund has a yearly fee of its own; a stock, a bond held directly, an option or a coin
// doesn't, so it's never "a cost I don't know".
const FUND_TYPES = new Set(["mutual fund", "etf"]);

export function ownedFacts(accounts: readonly InvestmentAccountView[]): OwnedFacts | null {
  const holdings = accounts.flatMap((a) => a.holdings);
  // Shares are of what the accounts list holdings for; "You own" is the same figure as the page's
  // "In total": each account's balance where the bank gives one (walk 11-17: $25,446 in the summary
  // against $31k in the tree, an HSA and a CD listing no holdings).
  const total = holdings.reduce((s, h) => s + h.valueCents, 0);
  if (total <= 0) return null;
  const owned = accounts.reduce(
    (s, a) => s + (a.balanceCents ?? a.holdings.reduce((n, h) => n + h.valueCents, 0)),
    0,
  );
  const unlisted = accounts.filter((a) => a.holdings.length === 0 && (a.balanceCents ?? 0) > 0);

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

  // One stock held in several accounts is one position: grouped by ticker (a holding with none
  // stands alone, never merged by its display name).
  const positions = new Map<string, (typeof holdings)[number]>();
  for (const h of holdings.filter((x) => x.type === "equity" && !x.isCash)) {
    const key = h.ticker ? `ticker:${h.ticker}` : `holding:${h.id}`;
    const have = positions.get(key);
    positions.set(key, have ? { ...have, valueCents: have.valueCents + h.valueCents } : h);
  }
  const stocks = [...positions.values()].sort((a, b) => b.valueCents - a.valueCents);
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
  const unknown = priced.filter(
    (h) => h.expenseRatioBps === null && FUND_TYPES.has((h.type ?? "").toLowerCase()),
  );
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
  // "Other" that is funds the table doesn't know is said as such, by name, after the rest
  // (debugger 11-01: "50% other" was a target-date fund and a stock fund); what's left of it (a
  // coin, an option: Plaid sandbox walk, 11-17) stays "other".
  const unseen = holdings.filter(
    (h) =>
      !h.isCash &&
      FUND_TYPES.has((h.type ?? "").toLowerCase()) &&
      h.expenseRatioBps === null &&
      (h.mix.other ?? 0) > 0,
  );
  const otherCents = byClass.get("other") ?? 0;
  const unseenCents = Math.min(
    otherCents,
    unseen.reduce((s, h) => s + h.valueCents * (h.mix.other ?? 0), 0),
  );
  const restCents = otherCents - unseenCents;
  const parts =
    unseen.length > 0
      ? [
          ...mix
            .filter((m) => m.assetClass !== "other")
            .map((m) => `${pct(m.share)} ${inSentence(m.label)}`),
          ...(restCents >= 1 ? [`${pct(restCents / total)} other`] : []),
          `${pct(unseenCents / total)} in funds whose mix I don't know (${unseen
            .slice(0, 4)
            .map((h) => h.ticker ?? h.name)
            .join(", ")}${unseen.length > 4 ? " and others" : ""})`,
        ]
      : mix.map((m) => `${pct(m.share)} ${inSentence(m.label)}`);
  sentences.push(
    owned > 0 && owned !== total
      ? `You own ${formatCents(owned)}. Of the ${formatCents(total)} your accounts list holdings for: ${parts.join(", ")}.`
      : `You own ${formatCents(total)}: ${parts.join(", ")}.`,
  );
  if (unlisted.length > 0) {
    const names = unlisted.map((a) => a.name);
    sentences.push(
      `${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`} ${names.length === 1 ? "doesn't" : "don't"} list what ${names.length === 1 ? "it holds" : "they hold"}.`,
    );
  }
  if (biggestStock) {
    sentences.push(
      `Your largest single stock is ${biggestStock.name}${biggestStock.ticker ? ` (${biggestStock.ticker})` : ""}, ${formatCents(biggestStock.valueCents)}, which is ${pct(biggestStock.share)} of ${owned > 0 && owned !== total ? "what your accounts list" : "everything you own"}.`,
    );
  }
  if (known.length > 0) {
    sentences.push(
      `The funds you hold cost about ${formatCents(fees.yearlyCents)} a year in fees${fees.top ? `, mostly ${fees.top.name} at ${formatCents(fees.top.yearlyCents)}` : ""}.`,
    );
  }
  if (fees.unknownNames.length > 0) {
    sentences.push(
      `I don't know the yearly cost of ${fees.unknownNames.slice(0, 4).join(", ")}${fees.unknownNames.length > 4 ? " and others" : ""}${known.length > 0 ? `, so ${fees.unknownNames.length === 1 ? "it's" : "they're"} not in that total` : ""}.`,
    );
  }
  if (cashCents > 0) {
    sentences.push(`${formatCents(cashCents)} (${pct(cash.share)}) is uninvested cash.`);
  }
  return { totalCents: total, mix, biggestStock, fees, cash, sentences };
}
