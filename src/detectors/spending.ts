import { SPENDING_DETECTOR_RATES as S } from "@/config/detectors-spending";
import { categoryOf } from "@/categorize/taxonomy";
import {
  DUPLICATE_CHARGE_MAX_PERCENT,
  DUPLICATE_CHARGE_WINDOW_DAYS,
  LARGE_CHARGE_MEDIAN_MULTIPLE,
  LARGE_CHARGE_MIN_CENTS,
  REFUND_MAX_AGE_DAYS,
} from "@/config/detection";
import { duplicatePairs } from "@/detection/rules/duplicate-charge";
import type { DetectionInput } from "@/detection/types";
import { formatCents } from "@/lib/money";
import type { ProfileInput, ProfileTx } from "@/profile/build";
import { type Confidence, type Detector, suggestionId } from "./contract";
import {
  evidence,
  cashKnown,
  liquidCents,
  listOf,
  nice,
  outCents,
  tx,
  weakest,
  headlineOf,
  clip,
} from "./helpers";

// Detectors for spending, bills and cash (spec step 263): duplicate subscriptions, price
// rises, bills worth negotiating, the same charge twice, a trial that turned into a
// charge, a balance too low for the month's bills, and a category running over. Pure; see
// ./contract.ts. The older ones for subscriptions, fees, idle cash and the emergency fund
// are in ./money.ts.

type Series = { description: string; pfc: string | null; txs: ProfileTx[] };

// Charges that repeat: the same description in at least `regularMonthsMin` months.
function regular(data: ProfileInput): Series[] {
  const by = new Map<string, ProfileTx[]>();
  for (const t of tx(data, (x) => x.amountCents > 0)) {
    by.set(t.description, [...(by.get(t.description) ?? []), t]);
  }
  return [...by.entries()]
    .filter(([, list]) => new Set(list.map((t) => t.date.slice(0, 7))).size >= S.regularMonthsMin)
    .map(([description, list]) => ({
      description,
      pfc: list[0].pfc,
      txs: [...list].sort((a, b) => a.date.localeCompare(b.date)),
    }));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const last = (s: Series) => s.txs[s.txs.length - 1].amountCents;

const duplicateSubscription: Detector = {
  capability: "subscriptions",
  topic: "duplicate_subscription",
  covers: ["subscriptions"],
  needs: [],
  detect({ profile, data }) {
    const dupCats: readonly string[] = S.duplicateCategories;
    const byCat = new Map<string, Series[]>();
    for (const s of regular(data)) {
      if (s.pfc && dupCats.includes(s.pfc)) byCat.set(s.pfc, [...(byCat.get(s.pfc) ?? []), s]);
    }
    const groups = [...byCat.values()].filter((g) => g.length >= 2);
    if (groups.length === 0) return null;
    // Drop the cheapest of each group: the one you'd least miss, a conservative saving.
    const cheapest = groups.map((g) => g.sort((a, b) => last(a) - last(b))[0]);
    const worth = cheapest.reduce((s, c) => s + last(c) * 12, 0);
    const names = groups.flat().map((s) => s.description);
    const charges = groups.flat().reduce((n, s) => n + s.txs.length, 0);
    return {
      id: suggestionId("subscriptions", "duplicate_subscription"),
      capability: "subscriptions",
      topic: "duplicate_subscription",
      title: "You pay for more than one of the same kind of service: keep the one you use",
      headline: headlineOf("Drop an overlapping subscription", worth, "saves"),
      short: clip(
        `You pay for ${listOf(names)}: dropping the cheapest of each kind saves ${formatCents(worth)} a year.`,
      ),
      worthCents: worth,
      worthKind: "saves",
      confidence: evidence(
        "seen",
        profile.months,
        charges,
        "charges from overlapping subscriptions",
      ),
      urgency: "later",
      why: `You pay for ${listOf(names)} every month. Dropping the cheapest of each kind saves about ${formatCents(worth)} a year.`,
      action: { label: "Review subscriptions", href: "/subscriptions" },
      // The cheapest of each kind stops being charged.
      watch: {
        kind: "charge_stops",
        payees: cheapest.map((c) => ({
          description: c.description,
          amountCents: last(c),
          perYear: 12,
        })),
      },
    };
  },
};

const priceIncrease: Detector = {
  capability: "subscriptions",
  topic: "price_increase",
  covers: [],
  needs: [],
  detect({ profile, data }) {
    const rises = regular(data)
      .filter((s) => s.txs.length >= S.priceRiseMinCharges)
      .filter((s) => !s.txs.some((t) => S.priceRiseNot.includes(t.pfc ?? "")))
      .flatMap((s) => {
        const earlier = s.txs.slice(0, -1).map((t) => t.amountCents);
        const before = median(earlier);
        const now = last(s);
        // A fixed price: most earlier charges were the same. A bill that moves every month
        // (a utility, a processor's fees) is not a price rise.
        const fixed =
          earlier.filter((a) => a === before).length / earlier.length >= S.fixedPriceShare;
        return fixed &&
          before > 0 &&
          now >= before * (1 + S.priceRiseShare) &&
          now - before >= S.priceRiseMinCents
          ? [{ s, before, now }]
          : [];
      });
    if (rises.length === 0) return null;
    const worth = rises.reduce((n, r) => n + (r.now - r.before) * 12, 0);
    const top = rises.sort((a, b) => b.now - b.before - (a.now - a.before))[0];
    return {
      id: suggestionId("subscriptions", "price_increase"),
      capability: "subscriptions",
      topic: "price_increase",
      title: "A charge went up: check it, and ask for the old price or switch",
      headline: headlineOf("Push back on a price rise", worth, "saves"),
      short: clip(
        `${nice(top.s.description)} went from ${formatCents(top.before)} to ${formatCents(top.now)} a month.`,
      ),
      worthCents: worth,
      worthKind: "saves",
      confidence: evidence(
        "seen",
        profile.months,
        rises.reduce((n, r) => n + r.s.txs.length - 1, 0),
        "charges at the old price",
      ),
      urgency: "soon",
      why: `${nice(top.s.description)} went from ${formatCents(top.before)} to ${formatCents(top.now)} a month${rises.length > 1 ? `, and ${rises.length - 1} more went up` : ""}: ${formatCents(worth)} more a year.`,
      action: { label: "See what changed", href: "/jane#alerts" },
      // The charge comes in below its new price again (the old price back, or a cheaper plan).
      watch: {
        kind: "bill_drops",
        payees: rises.map((r) => ({
          description: r.s.description,
          beforeCents: r.now,
          perYear: 12,
        })),
      },
    };
  },
};

const INTERNET = "RENT_AND_UTILITIES_INTERNET_AND_CABLE";
const PHONE = "RENT_AND_UTILITIES_TELEPHONE";

const billNegotiation: Detector = {
  capability: "cost",
  topic: "bill_negotiation",
  covers: [],
  needs: [],
  detect({ profile, data }) {
    const bills = regular(data)
      .filter(
        (s) =>
          (s.pfc === INTERNET && last(s) >= S.internetBillMinCents) ||
          (s.pfc === PHONE && last(s) >= S.phoneBillMinCents),
      )
      .map((s) => ({ s, yearly: last(s) * 12 }));
    if (bills.length === 0) return null;
    const yearly = bills.reduce((n, b) => n + b.yearly, 0);
    return {
      id: suggestionId("cost", "bill_negotiation"),
      capability: "cost",
      topic: "bill_negotiation",
      // Worth asking, never "too high": the checkup may call the same bill a typical price
      // (manager decision 10-30).
      title: "Worth asking for a lower rate on your internet or phone bill",
      headline: headlineOf(
        "Ask for a lower bill rate",
        Math.round(yearly * S.negotiationShare),
        "saves",
      ),
      short: clip(
        `You pay ${formatCents(yearly)} a year on ${bills.map((b) => nice(b.s.description)).join(" and ")}.`,
      ),
      worthCents: Math.round(yearly * S.negotiationShare),
      worthKind: "saves",
      confidence: evidence(
        "seen",
        profile.months,
        bills.reduce((n, b) => n + b.s.txs.length, 0),
        "bill payments",
      ),
      urgency: "later",
      why: `You pay ${bills.map((b) => `${nice(b.s.description)} ${formatCents(last(b.s))} a month`).join(" and ")}, ${formatCents(yearly)} a year. Even at a typical price it's still worth asking: people who ask usually get about ${Math.round(S.negotiationShare * 100)}% off.`,
      action: { label: "See your bills", href: "/bills" },
      watch: {
        kind: "bill_drops",
        payees: bills.map((b) => ({
          description: b.s.description,
          beforeCents: last(b.s),
          perYear: 12,
        })),
      },
    };
  },
};

const DAY_MS = 86_400_000;

// A confidence no surer than what the accuracy bench shows this kind of suggestion earns.
const capped = (c: Confidence, max: number): Confidence => ({
  ...c,
  percent: Math.min(c.percent, max),
});

// The person's transactions as the finding rules read them; a row's id is its index.
function asDetectionInput(data: ProfileInput): DetectionInput {
  return {
    asOf: data.today,
    accounts: [],
    recurringStreams: [],
    transactions: data.transactions.map((t, i) => ({
      id: String(i),
      accountId: t.accountId,
      plaidTransactionId: null,
      date: t.date,
      amountCents: t.amountCents,
      description: t.description,
      merchantName: null,
      pfcPrimary: t.pfc ? (categoryOf(t.pfc)?.primary ?? null) : null,
      pfcDetailed: t.pfc,
      categorySource: null,
    })),
  };
}

const duplicateCharge: Detector = {
  capability: "cost",
  topic: "duplicate_charge",
  covers: [],
  needs: [],
  detect({ profile, data }) {
    // The double-charge finding's own definition (src/detection/rules/duplicate-charge.ts): the
    // same amount at the same merchant on one account within a day, not where repeats are
    // normal (food, transport, money moving), not already refunded, and recent enough to
    // dispute. Its own looser rule called a refunded double, or two lunches, a double charge
    // (accuracy bench: right 14 times in 28).
    const doubles = duplicatePairs(asDetectionInput(data))
      .filter(
        ({ second }) =>
          (Date.parse(data.today) - Date.parse(second.date)) / DAY_MS <= REFUND_MAX_AGE_DAYS,
      )
      .map(({ second }) => data.transactions[Number(second.id)]);
    if (doubles.length === 0) return null;
    const total = outCents(doubles);
    return {
      id: suggestionId("cost", "duplicate_charge"),
      capability: "cost",
      topic: "duplicate_charge",
      title: "You may have been charged twice: ask for one back",
      headline: headlineOf("Claim back a double charge", total, "earns", true),
      short: clip(
        `${doubles.map((d) => `${nice(d.description)} ${formatCents(d.amountCents)}`).join(", ")} was charged twice.`,
      ),
      worthCents: total,
      worthKind: "earns",
      confidence: capped(
        evidence("seen", profile.months, doubles.length, "identical charges within a day"),
        DUPLICATE_CHARGE_MAX_PERCENT,
      ),
      urgency: "now",
      why: `${doubles.map((d) => `${nice(d.description)} ${formatCents(d.amountCents)}`).join(", ")} appeared twice within ${DUPLICATE_CHARGE_WINDOW_DAYS === 1 ? "a day" : `${DUPLICATE_CHARGE_WINDOW_DAYS} days`}.`,
      action: { label: "See the charges", href: "/jane#alerts" },
      watch: {
        kind: "refund",
        payees: doubles.map((d) => ({ description: d.description, amountCents: d.amountCents })),
      },
    };
  },
};

const trialConversion: Detector = {
  capability: "subscriptions",
  topic: "trial_conversion",
  covers: [],
  needs: [],
  detect({ profile, data }) {
    const by = new Map<string, ProfileTx[]>();
    for (const t of tx(data, (x) => x.amountCents > 0)) {
      by.set(t.description, [...(by.get(t.description) ?? []), t]);
    }
    const converted = [...by.entries()].flatMap(([description, list]) => {
      const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
      const trial = sorted.find((t) => t.amountCents <= S.trialMaxCents);
      const after = trial
        ? sorted.filter((t) => t.date > trial.date && t.amountCents >= S.trialConvertedMinCents)
        : [];
      if (!trial || after.length === 0) return [];
      // How often it charges, from the paid charges' spacing; one paid charge says nothing
      // about that, so it counts once (debugger 10-30: one $120 MasterClass charge read as
      // "$1,440 a year", as if monthly).
      const span =
        (Date.parse(after[after.length - 1].date) - Date.parse(after[0].date)) / 86_400_000;
      const perYear =
        after.length < 2
          ? 1
          : Math.min(12, Math.max(1, Math.round((365 * (after.length - 1)) / span)));
      return [
        {
          description,
          price: after[after.length - 1].amountCents,
          n: after.length,
          perYear,
          paced: after.length >= 2,
        },
      ];
    });
    if (converted.length === 0) return null;
    const worth = converted.reduce((s, c) => s + c.price * c.perYear, 0);
    const yearly = converted.every((c) => c.paced);
    const total = `${formatCents(worth)}${yearly ? " a year" : ""}`;
    return {
      id: suggestionId("subscriptions", "trial_conversion"),
      capability: "subscriptions",
      topic: "trial_conversion",
      title: "A free trial turned into a paid subscription: keep it or cancel it",
      headline: headlineOf("Cancel a trial now billing you", worth, "saves", !yearly),
      short: clip(
        `${converted.map((c) => nice(c.description)).join(", ")} now costs you ${total}.`,
      ),
      worthCents: worth,
      worthKind: "saves",
      confidence: evidence(
        "seen",
        profile.months,
        converted.reduce((s, c) => s + c.n, 0),
        "charges after a trial",
      ),
      urgency: "soon",
      why: `${converted.map((c) => `${nice(c.description)} started with a small trial charge and now costs ${formatCents(c.price)}${c.paced ? "" : " (charged once since, so how often isn't known yet)"}`).join("; ")}: ${total}.`,
      action: { label: "Review subscriptions", href: "/subscriptions" },
      watch: {
        kind: "charge_stops",
        payees: converted.map((c) => ({
          description: c.description,
          amountCents: c.price,
          perYear: c.perYear,
        })),
      },
    };
  },
};

const lowBalance: Detector = {
  capability: "safe_to_spend",
  topic: "low_balance",
  covers: ["tight_money"],
  needs: [],
  detect({ profile, data }) {
    // Cash in checking and savings: what could pay the month's bills. Unknown is not low.
    if (!cashKnown(data)) return null;
    const checking = liquidCents(data);
    // A month's regular bills: the latest charge of each regular series.
    const bills = regular(data).filter(
      (s) =>
        !(s.pfc ?? "").startsWith("TRANSFER") && !(s.pfc ?? "").startsWith("LOAN_PAYMENTS_CREDIT"),
    );
    const monthly = bills.reduce((n, s) => n + last(s), 0);
    if (bills.length === 0 || checking >= monthly * S.lowBalanceShare) return null;
    const fees = outCents(
      tx(
        data,
        (t) => t.pfc === "BANK_FEES_OVERDRAFT_FEES" || t.pfc === "BANK_FEES_INSUFFICIENT_FUNDS",
      ),
    );
    return {
      id: suggestionId("safe_to_spend", "low_balance"),
      capability: "safe_to_spend",
      topic: "low_balance",
      title: "Your cash is below a month of bills: keep more in checking until payday",
      headline: headlineOf(
        "Keep more cash in checking",
        Math.max(fees, monthly - checking),
        "risk",
      ),
      short: `${checking < 0 ? `You're ${formatCents(-checking)} overdrawn, with` : `You hold ${formatCents(checking)} against`} about ${formatCents(monthly)} a month in bills.`,
      worthCents: Math.max(fees, monthly - checking),
      worthKind: "risk",
      confidence: evidence("seen", profile.months, bills.length, "regular bills"),
      // Under half a month of bills in cash is urgent, and ranks by what's short (risk is
      // otherwise a fraction of its dollars).
      urgency: checking < monthly * S.lowCashUrgentShare ? "now" : "soon",
      ...(checking < monthly * S.lowCashUrgentShare
        ? { rankCents: Math.round((monthly - checking) * S.lowCashRank) }
        : {}),
      why: `Your checking and savings ${checking < 0 ? `are ${formatCents(-checking)} overdrawn` : `hold ${formatCents(checking)}`} and your regular bills come to about ${formatCents(monthly)} a month${fees ? `; overdraft fees have cost you ${formatCents(fees)}` : ""}.`,
      action: { label: "Plan a tight month", href: "/loans/tight" },
    };
  },
};

const budgetOverrun: Detector = {
  capability: "spending",
  topic: "budget_overrun",
  covers: [],
  needs: [],
  detect({ profile, data }) {
    const excluded: readonly string[] = S.budgetExcludedPrefixes;
    const month = (d: string) => d.slice(0, 7);
    const monthOf = (offset: number) => {
      const [y, m] = data.today.slice(0, 7).split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1 - offset, 1));
      return d.toISOString().slice(0, 7);
    };
    const lastMonth = monthOf(1);
    const prior = [monthOf(2), monthOf(3), monthOf(4)];
    const totals = new Map<string, Map<string, number>>();
    const charges = tx(data, (x) => x.amountCents > 0 && x.pfc !== null).filter((t) => {
      const m = month(t.date);
      return !excluded.some((p) => t.pfc!.startsWith(p)) && (m === lastMonth || prior.includes(m));
    });
    const groupOf = (t: ProfileTx) => categoryOf(t.pfc!)?.primary ?? t.pfc!;
    // A one-off big purchase (a laptop, a flight) isn't a month running over: it's left out
    // (messy-bank QA: one $1,899.99 purchase said "set a budget for general merchandise").
    const medians = new Map<string, number>();
    for (const group of new Set(charges.map(groupOf))) {
      const amounts = charges
        .filter((t) => groupOf(t) === group)
        .map((t) => t.amountCents)
        .sort((a, b) => a - b);
      medians.set(group, amounts[Math.floor(amounts.length / 2)]);
    }
    const oneOff = (t: ProfileTx) =>
      t.amountCents >= LARGE_CHARGE_MIN_CENTS &&
      t.amountCents >= (medians.get(groupOf(t)) ?? 0) * LARGE_CHARGE_MEDIAN_MULTIPLE;
    for (const t of charges) {
      if (oneOff(t)) continue;
      const group = groupOf(t);
      const m = month(t.date);
      const cat = totals.get(group) ?? new Map<string, number>();
      cat.set(m, (cat.get(m) ?? 0) + t.amountCents);
      totals.set(group, cat);
    }
    // Only months the data covers from their first day count toward "usual".
    const firstDay = data.transactions.reduce(
      (min, t) => (t.date < min ? t.date : min),
      data.today,
    );
    const full = prior.filter((m) => `${m}-01` >= firstDay);
    if (full.length < S.budgetOverrunMinMonths) return null;
    const over = [...totals.entries()]
      .map(([group, cat]) => {
        const avg = full.reduce((s, m) => s + (cat.get(m) ?? 0), 0) / full.length;
        const now = cat.get(lastMonth) ?? 0;
        return { group, avg, now, extra: now - avg };
      })
      .filter(
        (o) =>
          o.avg > 0 &&
          o.now >= o.avg * (1 + S.budgetOverrunShare) &&
          o.extra >= S.budgetOverrunMinCents,
      )
      .sort((a, b) => b.extra - a.extra);
    if (over.length === 0) return null;
    const top = over[0];
    const label = top.group.replace(/_/g, " ").toLowerCase();
    return {
      id: suggestionId("spending", "budget_overrun"),
      capability: "spending",
      topic: "budget_overrun",
      title: `Set a budget for ${label}: last month ran well over your usual`,
      headline: headlineOf(`Set a ${label} budget`, Math.round(top.extra), "saves"),
      short: `You spent ${formatCents(top.now)} on ${label} last month, usually about ${formatCents(Math.round(top.avg))}.`,
      worthCents: Math.round(top.extra),
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, prior.length + 1, `months of ${label} spending`),
        // One month over isn't a pattern: a party or a trip looks the same.
        evidence("guessed", profile.months, 1, "month over your usual (one month isn't a pattern)"),
      ]),
      urgency: "later",
      why: `You spent ${formatCents(top.now)} on ${label} last month against about ${formatCents(Math.round(top.avg))} in the ${full.length === 1 ? "month" : `${full.length} months`} before.`,
      action: { label: "Set a budget", href: "/budgets" },
    };
  },
};

export const SPENDING_DETECTORS: readonly Detector[] = [
  duplicateSubscription,
  priceIncrease,
  trialConversion,
  billNegotiation,
  duplicateCharge,
  lowBalance,
  budgetOverrun,
];
