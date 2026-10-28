import { DETECTOR_RATES as R } from "@/config/detectors";
import { FUND_FACTS, FUND_NAMES, LOWER_COST_EQUIVALENTS } from "@/config/funds";
import { formatCents } from "@/lib/money";
import { olderPlans } from "@/planning/rollover";
import { type Detector, suggestionId } from "./contract";
import {
  evidence,
  feeEvidence,
  factEvidence,
  liquidCents,
  monthlySpendCents,
  tx,
  weakest,
  headlineOf,
  clip,
} from "./helpers";
import type { ProfileHolding } from "@/profile/build";

// Detectors that read what the person holds (spec step 262): fees, drift from a sensible mix,
// automatic investing, old employer plans, where bonds sit and costly annuities. Pure; see
// ./contract.ts. Fund facts come from src/config/funds.ts (stand-ins until a fund-data partner
// is connected), so a holding Jane has no facts for is left out, never guessed.

const held = (list: readonly ProfileHolding[] | undefined) =>
  (list ?? []).filter((h) => !h.isCash && h.ticker && h.valueCents > 0);

const feeDrag: Detector = {
  capability: "investing",
  topic: "investment_fees",
  covers: ["investment_fees"],
  needs: [],
  detect({ profile, data }) {
    const rows = held(data.holdings).flatMap((h) => {
      const facts = FUND_FACTS[h.ticker!];
      const options = (LOWER_COST_EQUIVALENTS[h.ticker!] ?? [])
        .filter((t) => FUND_FACTS[t])
        .map((t) => ({ ticker: t, bps: FUND_FACTS[t].expenseRatioBps }))
        .sort((a, b) => a.bps - b.bps);
      const cheaper = options[0];
      if (!facts || !cheaper || facts.expenseRatioBps <= cheaper.bps) return [];
      return [
        {
          h,
          cheaper,
          saving: Math.round((h.valueCents * (facts.expenseRatioBps - cheaper.bps)) / 10_000),
        },
      ];
    });
    const total = rows.reduce((s, r) => s + r.saving, 0);
    if (total < R.feeMinCents) return null;
    const top = [...rows].sort((a, b) => b.saving - a.saving)[0];
    return {
      id: suggestionId("investing", "investment_fees"),
      capability: "investing",
      topic: "investment_fees",
      title: "Switch to cheaper funds that do the same job",
      headline: headlineOf("Switch to cheaper funds", total, "saves"),
      short: clip(
        `${FUND_NAMES[top.h.ticker!] ?? top.h.ticker} (${formatCents(top.h.valueCents)}) costs more than a similar fund.`,
      ),
      worthCents: total,
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, rows.length, "funds with a cheaper equivalent"),
        feeEvidence(
          rows.flatMap((r) => [FUND_FACTS[r.h.ticker!], FUND_FACTS[r.cheaper.ticker]]),
          data.today,
        ),
      ]),
      urgency: "later",
      why: `${rows.length === 1 ? "One of your funds costs" : `${rows.length} of your funds cost`} more than a similar fund. The largest is ${FUND_NAMES[top.h.ticker!] ?? top.h.ticker} (${formatCents(top.h.valueCents)}); switching all of them would save about ${formatCents(total)} a year in fees.`,
      action: { label: "See the fees", href: "/investments/fees" },
    };
  },
};

const STOCKS = ["us_stocks", "intl_stocks"] as const;
const drift: Detector = {
  capability: "investing",
  topic: "rebalance",
  covers: ["portfolio_review", "rebalance_plan", "investor_profile"],
  needs: ["life_stage", "risk"],
  detect({ profile, data }) {
    const stage = profile.facts.life_stage;
    const target = R.stockShareByStage[stage.value as keyof typeof R.stockShareByStage];
    if (target === undefined) return null;
    let stocks = 0;
    let total = 0;
    let count = 0;
    for (const h of held(data.holdings)) {
      const mix = FUND_FACTS[h.ticker!]?.mix;
      if (!mix) continue;
      count += 1;
      for (const [k, share] of Object.entries(mix)) {
        const part = h.valueCents * (share ?? 0);
        if (k === "cash") continue;
        total += part;
        if ((STOCKS as readonly string[]).includes(k)) stocks += part;
      }
    }
    if (total === 0) return null;
    const share = stocks / total;
    if (Math.abs(share - target) <= R.rebalanceBandShare) return null;
    const moved = Math.round(Math.abs(share - target) * total);
    return {
      id: suggestionId("investing", "rebalance"),
      capability: "investing",
      topic: "rebalance",
      title:
        share > target
          ? "Bring your stocks back toward your target"
          : "Put more of your money to work",
      headline: headlineOf(
        share > target ? "Rebalance toward your target" : "Put more money to work",
        moved,
        "risk",
      ),
      short: `${Math.round(share * 100)}% of what you invest is in stocks; people at your stage hold about ${Math.round(target * 100)}%.`,
      worthCents: moved,
      worthKind: "risk",
      confidence: weakest([
        {
          percent: stage.confidence,
          reason: "your target mix is a guess from your life stage until you answer four questions",
        },
        evidence("seen", profile.months, count, "funds with known holdings"),
      ]),
      urgency: "later",
      why: `${Math.round(share * 100)}% of what you invest is in stocks; people at your stage usually hold about ${Math.round(target * 100)}%. Moving about ${formatCents(moved)} would put you back near it. Four questions about your goals would let me check this against yours.`,
      action: { label: "Check your mix", href: "/investments/rebalance" },
    };
  },
};

const autoInvest: Detector = {
  capability: "investing",
  topic: "auto_invest",
  covers: ["auto_invest"],
  needs: ["income_pattern", "monthly_income"],
  detect({ profile, data }) {
    const pattern = profile.facts.income_pattern;
    const income = profile.facts.monthly_income;
    if (pattern.value !== "salary" || typeof income.value !== "number") return null;
    // Payroll contributions to a workplace plan are already regular investing, so only
    // accounts outside it count.
    const accounts = data.accounts.filter((a) =>
      ["brokerage", "ira", "roth"].includes(a.subtype ?? ""),
    );
    if (accounts.length === 0) return null;
    const spend = monthlySpendCents(data, profile.months);
    if (liquidCents(data) < spend * 3) return null;
    const regular = tx(data, (t) => /AUTOMATIC INVEST|RECURRING INVEST/i.test(t.description));
    if (regular.length > 0) return null;
    const monthly = Math.round(income.value * R.autoInvestShare);
    return {
      id: suggestionId("investing", "auto_invest"),
      capability: "investing",
      topic: "auto_invest",
      title: "Invest a little of every paycheck automatically",
      headline: headlineOf(
        "Invest a little from each paycheck",
        Math.round((monthly * 12 * (R.highYieldBps - R.currentCashBps)) / 10_000),
        "earns",
      ),
      short: `You're paid steadily and keep a cushion, but I see no regular investing: ${formatCents(monthly)} a month is the idea.`,
      worthCents: Math.round((monthly * 12 * (R.highYieldBps - R.currentCashBps)) / 10_000),
      worthKind: "earns",
      confidence: weakest([
        factEvidence(pattern),
        factEvidence(income),
        evidence("seen", profile.months, 0, "automatic investments"),
      ]),
      urgency: "later",
      why: `You are paid a steady salary, keep a cushion and have ${accounts.length === 1 ? "an investment account" : `${accounts.length} investment accounts`}, but I see no regular investing outside your workplace plan. ${Math.round(R.autoInvestShare * 100)}% of your pay is about ${formatCents(monthly)} a month, always moved after your bills are safe.`,
      action: { label: "Set up automatic investing", href: "/investments/auto" },
    };
  },
};

const oldAccounts: Detector = {
  capability: "investing",
  topic: "old_accounts",
  covers: ["old_accounts"],
  needs: ["has_401k"],
  detect({ profile, data }) {
    const plans = data.accounts.filter((a) => a.subtype === "401k");
    if (plans.length < 2) return null;
    const older = olderPlans(
      plans.map((a) => ({ id: a.id, name: a.name ?? "", balanceCents: a.balanceCents })),
      R.oldPlanFeeGapBps,
    );
    const old = older.totalCents;
    if (old === 0) return null;
    return {
      id: suggestionId("investing", "old_accounts"),
      capability: "investing",
      topic: "old_accounts",
      title: "Roll old employer plans into one account",
      headline: headlineOf(
        "Roll old employer plans into one",
        Math.round((old * R.oldPlanFeeGapBps) / 10_000),
        "saves",
      ),
      short: `You have ${plans.length} 401(k) accounts; ${formatCents(old)} sits in the old ones.`,
      worthCents: Math.round((old * R.oldPlanFeeGapBps) / 10_000),
      worthKind: "saves",
      confidence: weakest([
        factEvidence(profile.facts.has_401k),
        evidence("seen", profile.months, plans.length, "401(k) accounts"),
      ]),
      urgency: "later",
      why: `You have ${plans.length} 401(k) accounts; ${formatCents(old)} sits in the smaller one${plans.length > 2 ? "s" : ""}. Old plans often cost about ${R.oldPlanFeeGapBps / 100}% a year more, so rolling it over (moved directly, never withdrawn) saves about ${formatCents(Math.round((old * R.oldPlanFeeGapBps) / 10_000))} a year.`,
      action: { label: "See your old accounts", href: "/investments/old-accounts" },
    };
  },
};

const assetLocation: Detector = {
  capability: "investing",
  topic: "asset_location",
  covers: ["asset_location"],
  needs: [],
  detect({ profile, data }) {
    const kind = new Map(data.accounts.map((a) => [a.id, a.subtype]));
    const taxable = held(data.holdings).filter((h) => kind.get(h.accountId) === "brokerage");
    const shelter = held(data.holdings).filter((h) =>
      ["401k", "ira", "roth"].includes(kind.get(h.accountId) ?? ""),
    );
    const interest = taxable.filter((h) => FUND_FACTS[h.ticker!]?.interest);
    const inTaxable = interest.reduce((s, h) => s + h.valueCents, 0);
    const stocksSheltered = shelter
      .filter((h) => !FUND_FACTS[h.ticker!]?.interest)
      .reduce((s, h) => s + h.valueCents, 0);
    if (inTaxable === 0 || stocksSheltered === 0) return null;
    const moved = Math.min(inTaxable, stocksSheltered);
    const yieldBps = FUND_FACTS[interest[0].ticker!].yieldBps ?? 0;
    const saving = Math.round((moved * yieldBps * R.locationRateGap) / 10_000);
    if (saving < R.locationMinCents) return null;
    return {
      id: suggestionId("investing", "asset_location"),
      capability: "investing",
      topic: "asset_location",
      title: "Hold your bonds in the account where their interest isn't taxed each year",
      headline: headlineOf("Move bonds to a tax-sheltered account", saving, "saves"),
      short: `${formatCents(inTaxable)} of bond funds sit in a taxable account.`,
      worthCents: saving,
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, interest.length, "bond funds in a taxable account"),
        { percent: 70, reason: "your tax rate is assumed" },
      ]),
      urgency: "later",
      why: `${formatCents(inTaxable)} of bond funds sit in a taxable account, where the interest is taxed every year, while stock funds fill your retirement accounts. Swapping like for like (your mix doesn't change) would save about ${formatCents(saving)} a year in tax.`,
      action: { label: "See the swap", href: "/investments/location" },
    };
  },
};

const costlyAnnuity: Detector = {
  capability: "investing",
  topic: "costly_products",
  covers: ["costly_products"],
  needs: [],
  detect({ profile, data }) {
    const annuities = data.accounts.filter((a) => a.subtype === "annuity" && a.balanceCents > 0);
    if (annuities.length === 0) return null;
    const balance = annuities.reduce((s, a) => s + a.balanceCents, 0);
    const saving = Math.round((balance * (R.annuityFeeBps - R.annuityIndexBps)) / 10_000);
    return {
      id: suggestionId("investing", "costly_products"),
      capability: "investing",
      topic: "costly_products",
      title: "Check what your annuity really costs",
      headline: headlineOf("Check what your annuity costs", saving, "saves"),
      short: `You hold ${formatCents(balance)} in an annuity.`,
      worthCents: saving,
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, annuities.length, "annuity accounts"),
        { percent: 60, reason: "the annuity's fees are assumed, not read from its contract" },
      ]),
      urgency: "soon",
      why: `You hold ${formatCents(balance)} in an annuity. Many charge about ${R.annuityFeeBps / 100}% a year against ${R.annuityIndexBps / 100}% for an index fund, about ${formatCents(saving)} a year on your balance, and some charge to leave. Read its contract before changing anything.`,
      action: { label: "See costly products", href: "/investments/costly-products" },
    };
  },
};

export const HOLDINGS_DETECTORS: readonly Detector[] = [
  feeDrag,
  drift,
  autoInvest,
  oldAccounts,
  assetLocation,
  costlyAnnuity,
];
