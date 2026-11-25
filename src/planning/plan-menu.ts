import { CLASS_WORDS, type MenuClass } from "@/config/plan-menu";
import { FUND_FACTS } from "@/config/funds";
import { TARGET_MIXES, type RiskLevel } from "@/config/investing";

// The workplace plan's menu, used well (spec step 232, demo advice). Pure: read the menu from
// pasted text, find the cheapest mix of the plan's own funds that matches the person's target,
// check a target-date fund against building it by hand, and price the saving in dollars a
// year. Only funds on the menu are ever suggested.

export type MenuMix = { us_stocks: number; intl_stocks: number; bonds: number; cash: number };

export type MenuFund = {
  ticker: string;
  name: string;
  expenseBps: number;
  kind: MenuClass;
  // What the fund holds, for a target-date fund (and any fund Jane knows).
  mix: MenuMix | null;
};

export function classOf(text: string): MenuClass {
  for (const [kind, re] of CLASS_WORDS) if (re.test(text)) return kind;
  return "other";
}

const MENU_LINE_MAX_CHARS = 300;

// Lines like: KTSIX  Keystone Total US Stock Index Fund  0.03%  US stock
export function parseDisclosure(
  text: string,
  // A fund's holdings never come from who is looking, so neither the day nor the risk level is
  // used: a target-date fund Jane has no holdings for keeps `mix: null` (and no saving).
  _context: { today: string; risk: RiskLevel },
): { funds: MenuFund[]; skipped: string[] } {
  const funds: MenuFund[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // A fund's line is short, and the pattern below slows down with the fourth power of the length.
    const m =
      line.length > MENU_LINE_MAX_CHARS
        ? null
        : /^([A-Z]{3,6}X?)\s+(.+?)\s+(\d+(?:\.\d+)?)\s*%\s*(.*)$/.exec(line);
    if (!m) {
      skipped.push(line.slice(0, 80));
      continue;
    }
    const [, ticker, name, pct, rest] = m;
    const bps = Math.round(Number(pct) * 100);
    if (!(bps >= 0 && bps <= 500) || seen.has(ticker)) {
      skipped.push(line.slice(0, 80));
      continue;
    }
    seen.add(ticker);
    const kind = classOf(`${name} ${rest}`);
    const known = FUND_FACTS[ticker]?.mix;
    const mix: MenuMix | null = known
      ? {
          us_stocks: known.us_stocks ?? 0,
          intl_stocks: known.intl_stocks ?? 0,
          bonds: known.bonds ?? 0,
          cash: known.cash ?? 0,
        }
      : null;
    funds.push({ ticker, name: name.trim(), expenseBps: bps, kind, mix });
  }
  return { funds, skipped };
}

// A disclosure confirmed before target-date funds stopped getting a glide-path mix may still
// carry one for a fund Jane has no holdings for: read back, such a fund has no mix.
export const withoutGuessedMix = (funds: MenuFund[]): MenuFund[] =>
  funds.map((f) =>
    f.kind === "target_date" && !FUND_FACTS[f.ticker]?.mix ? { ...f, mix: null } : f,
  );

export type Allocation = { ticker: string; name: string; share: number; expenseBps: number }[];

const PURE = ["us_stocks", "intl_stocks", "bonds", "cash"] as const;

// The cheapest pure fund of each kind on the menu.
function cheapestByKind(menu: MenuFund[]): Partial<Record<(typeof PURE)[number], MenuFund>> {
  const out: Partial<Record<(typeof PURE)[number], MenuFund>> = {};
  for (const f of menu) {
    if (!(PURE as readonly string[]).includes(f.kind)) continue;
    const k = f.kind as (typeof PURE)[number];
    if (!out[k] || f.expenseBps < out[k]!.expenseBps) out[k] = f;
  }
  return out;
}

// The cheapest mix from the menu matching the target. A kind the menu lacks goes to the
// closest kind it has (cash to bonds, bonds to cash), and is said so.
export function cheapestMix(menu: MenuFund[], target: MenuMix) {
  const best = cheapestByKind(menu);
  const missing: string[] = [];
  // Kinds the target holds that no fund on the menu (nor its closest kind) can stand in for.
  const uncovered: string[] = [];
  const alloc = new Map<string, { fund: MenuFund; share: number }>();
  for (const kind of PURE) {
    const share = target[kind];
    if (share <= 0) continue;
    let fund = best[kind];
    if (!fund) {
      missing.push(kind);
      fund = kind === "cash" ? best.bonds : kind === "bonds" ? best.cash : undefined;
    }
    if (!fund) {
      uncovered.push(kind);
      continue;
    }
    const have = alloc.get(fund.ticker);
    alloc.set(fund.ticker, { fund, share: (have?.share ?? 0) + share });
  }
  const total = [...alloc.values()].reduce((s, a) => s + a.share, 0) || 1;
  const allocation: Allocation = [...alloc.values()].map(({ fund, share }) => ({
    ticker: fund.ticker,
    name: fund.name,
    share: share / total,
    expenseBps: fund.expenseBps,
  }));
  return { allocation, missing, uncovered, bps: weightedBps(allocation) };
}

export const weightedBps = (a: Allocation) => a.reduce((s, x) => s + x.share * x.expenseBps, 0);

// Yearly cost in cents of `bps` on a balance.
export const yearlyCents = (balanceCents: number, bps: number) =>
  Math.round((balanceCents * bps) / 10_000);

// A target-date fund against building its mix by hand from the cheapest funds.
export function targetDateCheck(menu: MenuFund[], fund: MenuFund, balanceCents: number) {
  if (!fund.mix) return null;
  const hand = cheapestMix(menu, fund.mix);
  // A hand-built mix that leaves out part of what the fund holds isn't like for like.
  if (hand.uncovered.length > 0 || hand.allocation.length === 0) return null;
  return {
    ticker: fund.ticker,
    fundBps: fund.expenseBps,
    handBps: hand.bps,
    fundCents: yearlyCents(balanceCents, fund.expenseBps),
    handCents: yearlyCents(balanceCents, hand.bps),
    savingCents: yearlyCents(balanceCents, fund.expenseBps - hand.bps),
    hand: hand.allocation,
  };
}

// What the person holds in the plan now, as allocation shares and cost, from tickers and values.
export function currentAllocation(
  menu: MenuFund[],
  holdings: { ticker: string | null; valueCents: number }[],
): Allocation {
  const total = holdings.reduce((s, h) => s + h.valueCents, 0) || 1;
  return holdings.flatMap((h) => {
    const f = menu.find((m) => m.ticker === h.ticker);
    return f
      ? [{ ticker: f.ticker, name: f.name, share: h.valueCents / total, expenseBps: f.expenseBps }]
      : [];
  });
}

export const targetFor = (risk: RiskLevel): MenuMix => ({ ...TARGET_MIXES[risk] });
