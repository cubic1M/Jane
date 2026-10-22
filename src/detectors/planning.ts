import { DETECTOR_RATES as R } from "@/config/detectors";
import {
  DEMO_EMPLOYER_PLAN_MENU,
  FUND_FACTS,
  FUND_NAMES,
  LOWER_COST_EQUIVALENTS,
} from "@/config/funds";
import {
  NOT_SUDDEN_DETAILED,
  NOT_SUDDEN_PRIMARY,
  SUDDEN_LOOKBACK_DAYS,
  SUDDEN_MIN_CENTS,
} from "@/config/sudden-money";
import { BENEFICIARY_SUBTYPES } from "@/config/family-file";
import { VALUES_EXCLUSIONS, VALUES_FUNDS, type Exclusion } from "@/config/values";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import {
  clip,
  dollars,
  evidence,
  headlineOf,
  liquidCents,
  monthlySpendCents,
  weakest,
} from "./helpers";

// Detectors for the second batch of investing tools (spec steps 232, 234 and 235): the
// workplace plan's own menu, cash that could work harder for a short time, and a big deposit
// that isn't pay. Pure; see ./contract.ts.

const planMenu: Detector = {
  capability: "investing",
  topic: "plan_menu",
  covers: ["plan_menu"],
  needs: ["has_401k"],
  detect({ profile, data }) {
    const plans = new Set(data.accounts.filter((a) => a.subtype === "401k").map((a) => a.id));
    const rows = (data.holdings ?? []).flatMap((h) => {
      if (!plans.has(h.accountId) || !h.ticker || h.isCash || h.valueCents <= 0) return [];
      const bps = FUND_FACTS[h.ticker]?.expenseRatioBps;
      const cheaper = (LOWER_COST_EQUIVALENTS[h.ticker] ?? [])
        .filter((t) => DEMO_EMPLOYER_PLAN_MENU.includes(t))
        .map((t) => ({ t, bps: FUND_FACTS[t]?.expenseRatioBps }))
        .filter((c): c is { t: string; bps: number } => c.bps !== undefined)
        .sort((a, b) => a.bps - b.bps)[0];
      if (bps === undefined || !cheaper || cheaper.bps >= bps) return [];
      return [
        { h, to: cheaper.t, saving: Math.round((h.valueCents * (bps - cheaper.bps)) / 10_000) },
      ];
    });
    const total = rows.reduce((s, r) => s + r.saving, 0);
    if (total < R.feeMinCents) return null;
    const top = [...rows].sort((a, b) => b.saving - a.saving)[0];
    return {
      id: suggestionId("investing", "plan_menu"),
      capability: "investing",
      topic: "plan_menu",
      title: "Use a cheaper fund from your own 401(k) menu",
      headline: headlineOf("Use a cheaper fund in your 401(k)", total, "saves"),
      short: clip(
        `Your 401(k) holds ${FUND_NAMES[top.h.ticker!] ?? top.h.ticker} (${formatCents(top.h.valueCents)}); your plan offers cheaper.`,
      ),
      worthCents: total,
      worthKind: "saves",
      confidence: weakest([
        evidence(
          "seen",
          profile.months,
          rows.length,
          "401(k) funds with a cheaper one on the menu",
        ),
        { percent: 70, reason: "your plan's menu isn't confirmed by you yet" },
      ]),
      urgency: "later",
      why: `Your 401(k) holds ${FUND_NAMES[top.h.ticker!] ?? top.h.ticker} (${formatCents(top.h.valueCents)}). Your plan's menu also offers ${FUND_NAMES[top.to] ?? top.to} for less; switching saves about ${formatCents(total)} a year in fees, inside the plan, with no tax.`,
      action: { label: "Read your plan's menu", href: "/investments/plan-menu" },
    };
  },
};

const shortTermCash: Detector = {
  capability: "investing",
  topic: "short_term_cash",
  covers: ["short_term_money"],
  needs: [],
  detect({ profile, data }) {
    const spend = monthlySpendCents(data, profile.months);
    const excess = liquidCents(data) - spend * R.idleMonthsKept;
    if (spend === 0 || excess < R.idleMinExcessCents) return null;
    return {
      id: suggestionId("investing", "short_term_cash"),
      capability: "investing",
      topic: "short_term_cash",
      title: "Put cash you need within a few years where it earns more, and is still safe",
      headline: headlineOf(
        "Put short-term cash in T-bills",
        Math.round((excess * R.shortTermGapBps) / 10_000),
        "earns",
      ),
      short: `About ${formatCents(excess)} of your cash is more than ${R.idleMonthsKept} months of spending.`,
      worthCents: Math.round((excess * R.shortTermGapBps) / 10_000),
      worthKind: "earns",
      confidence: weakest([
        evidence("seen", profile.months, data.accounts.length, "accounts"),
        { percent: 70, reason: "rates are stand-ins and your tax rate is assumed" },
      ]),
      urgency: "later",
      why: `About ${formatCents(excess)} of your cash is more than ${R.idleMonthsKept} months of spending. If you will need it within a few years, Treasury bills or CDs that mature when you need it pay about ${R.shortTermGapBps / 100} points more than savings, and a ladder never runs past the date.`,
      action: { label: "Compare safe places", href: "/investments/short-term" },
    };
  },
};

const suddenMoney: Detector = {
  capability: "investing",
  topic: "sudden_money",
  covers: ["sudden_money"],
  needs: [],
  detect({ profile, data }) {
    // For someone paid by clients or through a business, big deposits are how they are paid.
    if (
      profile.facts.income_pattern.value === "uneven" ||
      profile.facts.income_pattern.value === "business"
    ) {
      return null;
    }
    const last = new Date(`${data.today}T00:00:00Z`).getTime();
    const checking = new Set(
      data.accounts
        .filter((a) => a.subtype === "checking" || a.subtype === "savings")
        .map((a) => a.id),
    );
    const deposits = data.transactions.filter(
      (t) =>
        t.amountCents <= -SUDDEN_MIN_CENTS &&
        checking.has(t.accountId) &&
        last - new Date(`${t.date}T00:00:00Z`).getTime() <= SUDDEN_LOOKBACK_DAYS * 86_400_000 &&
        !NOT_SUDDEN_DETAILED.includes(t.pfc ?? "") &&
        !NOT_SUDDEN_PRIMARY.some((p) => (t.pfc ?? "").startsWith(p)),
    );
    if (deposits.length === 0) return null;
    const biggest = [...deposits].sort((a, b) => a.amountCents - b.amountCents)[0];
    const amount = -biggest.amountCents;
    const hold = Math.round(amount * R.suddenHoldShare);
    return {
      id: suggestionId("investing", "sudden_money"),
      capability: "investing",
      topic: "sudden_money",
      title: "Plan your big deposit: tax first, then the rest in order",
      headline: `Plan your big deposit, set aside ${dollars(hold)} for tax`,
      short: clip(
        `${formatCents(amount)} arrived on ${biggest.date}; keep about ${formatCents(hold)} aside for tax.`,
      ),
      worthCents: hold,
      worthKind: "risk",
      confidence: weakest([
        evidence("seen", profile.months, deposits.length, "large deposits that aren't pay"),
        { percent: 75, reason: "what the deposit was, and so its tax, is a guess until you say" },
      ]),
      urgency: "now",
      why: `${formatCents(amount)} arrived on ${biggest.date} and it doesn't look like pay. What it was decides the tax; until you say, about ${formatCents(hold)} (${Math.round(R.suddenHoldShare * 100)}%) is worth keeping aside. Then debt, your emergency fund, retirement limits, goals and investing, in that order.`,
      action: { label: "Plan it", href: "/investments/sudden-money" },
    };
  },
};

const beneficiaries: Detector = {
  capability: "investing",
  topic: "beneficiaries",
  covers: ["family_file"],
  needs: [],
  detect({ profile, data }) {
    if (!data.namedAccountIds) return null;
    const named = new Set(data.namedAccountIds);
    const open = data.accounts.filter(
      (a) =>
        BENEFICIARY_SUBTYPES.includes(a.subtype ?? "") && a.balanceCents > 0 && !named.has(a.id),
    );
    if (open.length === 0) return null;
    const total = open.reduce((s, a) => s + a.balanceCents, 0);
    return {
      id: suggestionId("investing", "beneficiaries"),
      capability: "investing",
      topic: "beneficiaries",
      title: "Name who gets your retirement accounts",
      worthCents: Math.round(total * R.beneficiaryRiskShare),
      worthKind: "risk",
      confidence: weakest([
        evidence("seen", profile.months, open.length, "accounts with no beneficiary I know of"),
        { percent: 75, reason: "you may have named someone with the company without telling me" },
      ]),
      urgency: "later",
      why: `${open.length === 1 ? "One account" : `${open.length} accounts`} holding ${formatCents(total)} ${open.length === 1 ? "has" : "have"} nobody named that I know of. An account with a named beneficiary passes to that person whatever a will says, and one with none can end up in a court process that often costs a few percent of the balance (about ${formatCents(Math.round(total * R.beneficiaryRiskShare))} here). Tell me who is named, or confirm it with the company.`,
      action: { label: "Check my accounts", href: "/investments/family-file" },
    };
  },
};

const valuesFunds: Detector = {
  capability: "investing",
  topic: "values_funds",
  covers: ["values_investing"],
  needs: [],
  detect({ profile, data }) {
    const list = (data.valuesExcludes ?? []).filter((k): k is Exclusion =>
      Object.hasOwn(VALUES_EXCLUSIONS, k),
    );
    if (list.length === 0) return null;
    const matches = (ticker: string) => {
      const f = VALUES_FUNDS.find((x) => x.ticker === ticker);
      return !!f && list.every((e) => f.excludes.includes(e));
    };
    const offending = (data.holdings ?? []).filter(
      (h) => h.ticker && !h.isCash && h.valueCents > 0 && !matches(h.ticker),
    );
    const total = offending.reduce((s, h) => s + h.valueCents, 0);
    if (total === 0) return null;
    return {
      id: suggestionId("investing", "values_funds"),
      capability: "investing",
      topic: "values_funds",
      title: "Move your funds in line with the list you gave me",
      worthCents: total,
      worthKind: "risk",
      confidence: weakest([
        evidence("told", profile.months, list.length, "things you asked me to leave out"),
        evidence("seen", profile.months, offending.length, "funds that don't match your list"),
      ]),
      urgency: "later",
      why: `You asked me to leave out ${list.map((k) => VALUES_EXCLUSIONS[k].toLowerCase()).join(", ")}. ${formatCents(total)} sits in ${offending.length} ${offending.length === 1 ? "fund" : "funds"} that may hold them. Switching stays inside the same kind of investment, so your stocks-and-bonds mix doesn't change; I show the fee difference in dollars and the effect on diversification first.`,
      action: { label: "See what would change", href: "/investments/values" },
    };
  },
};

export const PLANNING_DETECTORS: readonly Detector[] = [
  planMenu,
  shortTermCash,
  suddenMoney,
  valuesFunds,
  beneficiaries,
];
