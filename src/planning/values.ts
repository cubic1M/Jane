import { createHash } from "node:crypto";
import {
  DEMO_EMPLOYER_PLAN_MENU,
  EMPLOYER_PLAN_SUBTYPES,
  CORE_FUNDS,
  FUND_FACTS,
  FUND_NAMES,
} from "@/config/funds";
import {
  CORE_HOLDINGS,
  THEME_TILT_SHARE,
  VALUES_EXCLUSIONS,
  VALUES_FUNDS,
  VALUES_MIN_SWITCH_CENTS,
  type Exclusion,
  type Theme,
  type ValuesFund,
} from "@/config/values";
import { TAXABLE_INVESTMENT_SUBTYPES } from "@/config/tax";
import type { InvestmentAccountView } from "@/insights/investments";

// Investing by your values (spec step 236). Leaving things out or leaning towards a theme is
// done inside each kind of investment, so the person's stocks-and-bonds mix, and the risk
// that goes with it, never changes. What it costs (the fee difference in dollars a year, and
// any tax on a sale in a taxable account) and what it does to diversification are worked
// out and shown, not hidden. Pure.

export type Prefs = { excludes: Exclusion[]; themes: Theme[] };
export type ClassKey = ValuesFund["assetClass"];

export const hasPrefs = (p: Prefs) => p.excludes.length > 0 || p.themes.length > 0;

export type FundChoice = {
  ticker: string;
  name: string;
  assetClass: ClassKey;
  // What it leaves out of the person's list, and what it can't.
  covers: Exclusion[];
  missing: Exclusion[];
  expenseRatioBps: number;
  holdings: number;
  keptBps: number;
};

const tagsOf = (ticker: string) => VALUES_FUNDS.find((f) => f.ticker === ticker);
const bpsOf = (ticker: string) => FUND_FACTS[ticker]?.expenseRatioBps ?? 0;

function choiceOf(
  ticker: string,
  assetClass: ClassKey,
  excludes: readonly Exclusion[],
  holdings: number,
  keptBps: number,
  prefs: Prefs,
): FundChoice {
  return {
    ticker,
    name: FUND_NAMES[ticker] ?? ticker,
    assetClass,
    covers: prefs.excludes.filter((e) => excludes.includes(e)),
    missing: prefs.excludes.filter((e) => !excludes.includes(e)),
    expenseRatioBps: bpsOf(ticker),
    holdings,
    keptBps,
  };
}

// The fund for a kind of investment: leaves out the most of what the person listed, then
// the cheapest. Theme funds are tilts, never the fund for a whole kind.
export function fundFor(assetClass: ClassKey, prefs: Prefs): FundChoice {
  const options = [
    choiceOf(
      CORE_FUNDS[assetClass],
      assetClass,
      [],
      CORE_HOLDINGS[assetClass].holdings,
      CORE_HOLDINGS[assetClass].keptBps,
      prefs,
    ),
    ...VALUES_FUNDS.filter((f) => f.assetClass === assetClass && f.themes.length === 0).map((f) =>
      choiceOf(f.ticker, assetClass, f.excludes, f.holdings, f.keptBps, prefs),
    ),
  ];
  return options.sort(
    (a, b) => a.missing.length - b.missing.length || a.expenseRatioBps - b.expenseRatioBps,
  )[0];
}

// The funds Jane buys for each kind of investment, for the rebalance and automatic investing
// (the plain index funds when nothing is listed).
export function coreFundsFor(
  prefs: Prefs,
): Record<"us_stocks" | "intl_stocks" | "bonds" | "cash", string> {
  return {
    us_stocks: fundFor("us_stocks", prefs).ticker,
    intl_stocks: fundFor("intl_stocks", prefs).ticker,
    bonds: fundFor("bonds", prefs).ticker,
    cash: CORE_FUNDS.cash,
  };
}

// The theme fund for a tilt, only if it also leaves out everything the person listed.
export function tiltFund(prefs: Prefs): FundChoice | null {
  for (const f of VALUES_FUNDS) {
    if (f.themes.length === 0 || !f.themes.some((t) => prefs.themes.includes(t))) continue;
    const c = choiceOf(f.ticker, f.assetClass, f.excludes, f.holdings, f.keptBps, prefs);
    if (c.missing.length === 0) return c;
  }
  return null;
}

export type Leg = { ticker: string; name: string; amountCents: number };
export type Switch = {
  accountId: string;
  accountName: string;
  taxable: boolean;
  from: { ticker: string; name: string; valueCents: number; expenseRatioBps: number };
  assetClass: ClassKey;
  legs: Leg[];
  // What the fees change by in a year, in cents: positive is dearer.
  feeDeltaCents: number;
  // Taxable sales only: the gain (or loss) the sale realises, when the cost basis is known.
  gainCents: number | null;
};

export type Skipped = { accountName: string; name: string; reason: string };

export type ValuesPlan = {
  prefs: Prefs;
  switches: Switch[];
  skipped: Skipped[];
  movedCents: number;
  feeDeltaCents: number;
  gainCents: number;
  // Per kind of investment: how many holdings and how much of the market, before and after.
  diversification: {
    assetClass: ClassKey;
    beforeHoldings: number;
    afterHoldings: number;
    keptBps: number;
  }[];
  // Kind of investment → cents before and after: always equal (the risk target holds).
  classTotals: Record<ClassKey, { before: number; after: number }>;
  notes: string[];
  key: string;
};

const isEmployerPlan = (subtype: string | null) =>
  EMPLOYER_PLAN_SUBTYPES.includes((subtype ?? "").toLowerCase());
const isTaxable = (subtype: string | null) =>
  TAXABLE_INVESTMENT_SUBTYPES.includes((subtype ?? "").toLowerCase());

const classOf = (mix: Record<string, number | undefined>): ClassKey | null => {
  for (const c of ["us_stocks", "intl_stocks", "bonds"] as const)
    if ((mix[c] ?? 0) >= 0.95) return c;
  return null;
};

export function valuesPlan(accounts: InvestmentAccountView[], prefs: Prefs): ValuesPlan {
  const classTotals: ValuesPlan["classTotals"] = {
    us_stocks: { before: 0, after: 0 },
    intl_stocks: { before: 0, after: 0 },
    bonds: { before: 0, after: 0 },
  };
  const switches: Switch[] = [];
  const skipped: Skipped[] = [];
  const tilt = tiltFund(prefs);
  const diversified = new Map<ClassKey, { before: number; after: number; kept: number }>();
  for (const account of accounts) {
    const menu = isEmployerPlan(account.subtype) ? DEMO_EMPLOYER_PLAN_MENU : null;
    for (const h of account.holdings) {
      if (h.isCash || !h.ticker || h.valueCents <= 0) continue;
      const cls = classOf(h.mix);
      if (!cls) {
        skipped.push({
          accountName: account.name,
          name: h.name,
          reason: "holds several kinds of investment at once, so it's left as it is",
        });
        continue;
      }
      classTotals[cls].before += h.valueCents;
      classTotals[cls].after += h.valueCents;
      const tags = tagsOf(h.ticker);
      const current = choiceOf(
        h.ticker,
        cls,
        tags?.excludes ?? [],
        tags?.holdings ?? CORE_HOLDINGS[cls].holdings,
        tags?.keptBps ?? CORE_HOLDINGS[cls].keptBps,
        prefs,
      );
      const target = fundFor(cls, prefs);
      const switching =
        hasPrefs(prefs) &&
        target.ticker !== h.ticker &&
        target.missing.length < current.missing.length &&
        h.valueCents >= VALUES_MIN_SWITCH_CENTS;
      const tilting =
        !!tilt &&
        cls === "us_stocks" &&
        h.ticker !== tilt.ticker &&
        h.valueCents >= VALUES_MIN_SWITCH_CENTS;
      if (!switching && !tilting) continue;
      const base = switching ? target : current;
      const legs: Leg[] = [];
      const tiltCents = tilting ? Math.round(h.valueCents * THEME_TILT_SHARE) : 0;
      const baseCents = h.valueCents - tiltCents;
      const offered = (t: string) => !menu || menu.includes(t);
      if (!offered(base.ticker) || (tiltCents > 0 && !offered(tilt!.ticker))) {
        if (!switching || !offered(base.ticker)) {
          skipped.push({
            accountName: account.name,
            name: h.name,
            reason: "the screened fund isn't on your workplace plan's menu",
          });
          continue;
        }
      }
      legs.push({ ticker: base.ticker, name: base.name, amountCents: baseCents });
      if (tiltCents > 0 && offered(tilt!.ticker)) {
        legs.push({ ticker: tilt!.ticker, name: tilt!.name, amountCents: tiltCents });
      } else if (tiltCents > 0) {
        legs[0].amountCents += tiltCents;
      }
      // Staying put in the same fund isn't a switch.
      if (legs.length === 1 && legs[0].ticker === h.ticker) continue;
      const feeBefore = (h.valueCents * (h.expenseRatioBps ?? bpsOf(h.ticker))) / 10_000;
      const feeAfter = legs.reduce((s, l) => s + (l.amountCents * bpsOf(l.ticker)) / 10_000, 0);
      const taxable = isTaxable(account.subtype);
      switches.push({
        accountId: account.id,
        accountName: account.name,
        taxable,
        from: {
          ticker: h.ticker,
          name: h.name,
          valueCents: h.valueCents,
          expenseRatioBps: h.expenseRatioBps ?? bpsOf(h.ticker),
        },
        assetClass: cls,
        legs,
        feeDeltaCents: Math.round(feeAfter - feeBefore),
        gainCents: taxable && h.costBasisCents !== null ? h.valueCents - h.costBasisCents : null,
      });
      const d = diversified.get(cls) ?? { before: 0, after: 0, kept: 0 };
      d.before = Math.max(d.before, current.holdings);
      d.after = Math.max(d.after, base.holdings);
      d.kept = Math.max(d.kept, base.keptBps);
      diversified.set(cls, d);
    }
  }
  const movedCents = switches.reduce((s, x) => s + x.from.valueCents, 0);
  const notes: string[] = [];
  for (const cls of ["us_stocks", "intl_stocks", "bonds"] as const) {
    const t = fundFor(cls, prefs);
    if (t.missing.length > 0 && hasPrefs(prefs)) {
      notes.push(
        `No stand-in fund for ${cls.replace("_", " ")} leaves out ${t.missing.map((m) => VALUES_EXCLUSIONS[m].toLowerCase()).join(", ")}; the closest one is used.`,
      );
    }
  }
  if (prefs.themes.length > 0 && !tilt) {
    notes.push("No theme fund also leaves out everything on your list, so no tilt is added.");
  }
  return {
    prefs,
    switches,
    skipped,
    movedCents,
    feeDeltaCents: switches.reduce((s, x) => s + x.feeDeltaCents, 0),
    gainCents: switches.reduce((s, x) => s + (x.gainCents ?? 0), 0),
    diversification: [...diversified].map(([assetClass, d]) => ({
      assetClass,
      beforeHoldings: d.before,
      afterHoldings: d.after,
      keptBps: d.kept,
    })),
    classTotals,
    notes,
    key: createHash("sha256")
      .update(
        JSON.stringify(
          switches.map((s) => [
            s.accountId,
            s.from.ticker,
            s.legs.map((l) => [l.ticker, l.amountCents]),
          ]),
        ),
      )
      .digest("hex")
      .slice(0, 16),
  };
}
