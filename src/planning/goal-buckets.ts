import { CORE_FUNDS } from "@/config/funds";
import {
  GLIDE_PATH,
  INTL_SHARE_OF_STOCKS,
  NEAR_TERM_YEARS,
  TARGET_MIXES,
  type RiskLevel,
} from "@/config/investing";
import { DAY_MS } from "@/lib/dates";
import { formatPercent as pct } from "@/lib/percent";

// Every goal invested for its timeline (spec step 157, demo advice). Pure. Each goal gets a
// bucket whose mix follows the glide path for the years left (src/config/investing.ts):
// cash under 3 years, more stocks the further away, never more stocks than the person's
// risk level allows. New money is split across the buckets by what each needs a month.

export type Mix = { us_stocks: number; intl_stocks: number; bonds: number; cash: number };

export type GoalInputs = {
  id: string;
  name: string;
  targetDate: string;
  // What it still needs each month, from goal progress (0 once reached).
  monthlyCents: number;
};

export type Bucket = {
  id: string;
  name: string;
  yearsLeft: number;
  nearTerm: boolean;
  mix: Mix;
  monthlyCents: number;
  // Why this mix, in a sentence.
  why: string;
};

export const yearsUntil = (asOf: string, date: string) =>
  Math.max(
    0,
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / DAY_MS / 365.25,
  );

// The mix for money needed in `years`, capped at the risk level's stocks.
export function glideMix(years: number, riskLevel: RiskLevel): Mix {
  const step = GLIDE_PATH.find((g) => years >= g.fromYears) ?? GLIDE_PATH[GLIDE_PATH.length - 1];
  if (step.stocks === 0) return { us_stocks: 0, intl_stocks: 0, bonds: 0, cash: 1 };
  const t = TARGET_MIXES[riskLevel];
  const cap = t.us_stocks + t.intl_stocks;
  const stocks = Math.min(step.stocks, cap);
  // Stocks taken out by the cap go to bonds.
  const bonds = step.bonds + (step.stocks - stocks);
  return {
    us_stocks: stocks * (1 - INTL_SHARE_OF_STOCKS),
    intl_stocks: stocks * INTL_SHARE_OF_STOCKS,
    bonds,
    cash: step.cash,
  };
}

const yearsWords = (y: number) =>
  y < 1
    ? "less than a year away"
    : `${Math.round(y)} ${Math.round(y) === 1 ? "year" : "years"} away`;

export function goalBuckets(goals: GoalInputs[], asOf: string, riskLevel: RiskLevel): Bucket[] {
  return goals.map((g) => {
    const yearsLeft = yearsUntil(asOf, g.targetDate);
    const mix = glideMix(yearsLeft, riskLevel);
    const nearTerm = yearsLeft < NEAR_TERM_YEARS;
    const stocks = mix.us_stocks + mix.intl_stocks;
    return {
      id: g.id,
      name: g.name,
      yearsLeft,
      nearTerm,
      mix,
      monthlyCents: g.monthlyCents,
      why: nearTerm
        ? `${yearsWords(yearsLeft)}: kept in cash, because stocks can fall a lot in a year or two and this money has to be there.`
        : `${yearsWords(yearsLeft)}: ${pct(stocks)} stocks and ${pct(mix.bonds + mix.cash)} bonds and cash, getting safer as the date nears.`,
    };
  });
}

export type Split = {
  // Kept as cash, for near-term goals (and anything left over below the minimum).
  cashCents: number;
  buys: { ticker: string; amountCents: number }[];
  perBucket: { id: string; amountCents: number }[];
};

// New money across the buckets: near-term goals' monthly needs first (they can't wait),
// then the rest in proportion to each longer goal's need; with no needs at all, all of it
// to the longest goal. Each bucket's share is bought in its own mix, to the cent.
export function splitNewMoney(amountCents: number, buckets: Bucket[]): Split {
  const perBucket = new Map<string, number>();
  let left = amountCents;
  for (const b of buckets.filter((x) => x.nearTerm && x.monthlyCents > 0)) {
    const share = Math.min(left, b.monthlyCents);
    perBucket.set(b.id, share);
    left -= share;
  }
  const longer = buckets.filter((x) => !x.nearTerm);
  const need = longer.reduce((s, b) => s + b.monthlyCents, 0);
  if (left > 0 && longer.length > 0) {
    const targets =
      need > 0
        ? longer.filter((b) => b.monthlyCents > 0)
        : [[...longer].sort((a, b) => b.yearsLeft - a.yearsLeft)[0]];
    const weight = need > 0 ? need : 1;
    let given = 0;
    targets.forEach((b, i) => {
      const share =
        i === targets.length - 1
          ? left - given
          : Math.floor((left * (need > 0 ? b.monthlyCents : 1)) / weight);
      given += share;
      perBucket.set(b.id, (perBucket.get(b.id) ?? 0) + share);
    });
    left = 0;
  }
  // Money that has nowhere to go stays as cash.
  let cash = left;
  const byTicker = new Map<string, number>();
  for (const b of buckets) {
    const amount = perBucket.get(b.id) ?? 0;
    if (amount === 0) continue;
    const parts = (["us_stocks", "intl_stocks", "bonds"] as const).map((c) => ({
      ticker: CORE_FUNDS[c],
      amountCents: Math.floor(amount * b.mix[c]),
    }));
    const bought = parts.reduce((s, p) => s + p.amountCents, 0);
    cash += amount - bought;
    for (const p of parts) {
      if (p.amountCents > 0) byTicker.set(p.ticker, (byTicker.get(p.ticker) ?? 0) + p.amountCents);
    }
  }
  return {
    cashCents: cash,
    buys: [...byTicker].map(([ticker, amountCents]) => ({ ticker, amountCents })),
    perBucket: [...perBucket].map(([id, amountCents]) => ({ id, amountCents })),
  };
}
