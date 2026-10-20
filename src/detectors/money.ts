import { DETECTOR_RATES as R } from "@/config/detectors";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import {
  evidence,
  factEvidence,
  liquidCents,
  monthlySpendCents,
  outCents,
  tx,
  weakest,
} from "./helpers";

// Detectors for everyday money (spec step 254): subscriptions, fees, card interest, idle
// cash, the emergency fund and debt in trouble. Pure; see ./contract.ts.

const SUBSCRIPTION_CATEGORIES = new Set([
  "ENTERTAINMENT_TV_AND_MOVIES",
  "ENTERTAINMENT_MUSIC_AND_AUDIO",
  "ENTERTAINMENT_VIDEO_GAMES",
  "ENTERTAINMENT_OTHER_ENTERTAINMENT",
  "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
  "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
]);

const subscriptions: Detector = {
  covers: ["subscriptions"],
  capability: "subscriptions",
  topic: "subscriptions",
  needs: [],
  detect({ profile, data }) {
    const charges = tx(
      data,
      (t) =>
        t.amountCents > 0 &&
        t.amountCents < R.subscriptionMaxCents &&
        SUBSCRIPTION_CATEGORIES.has(t.pfc ?? ""),
    );
    const byName = new Map<string, number[]>();
    for (const t of charges)
      byName.set(t.description, [...(byName.get(t.description) ?? []), t.amountCents]);
    // A subscription is the same charge in at least three different months.
    const regular = [...byName.values()].filter((list) => list.length >= R.subscriptionMinCharges);
    if (regular.length < R.subscriptionsMin) return null;
    const yearly = regular.reduce(
      (s, list) => s + (list.reduce((a, b) => a + b, 0) / list.length) * 12,
      0,
    );
    const count = regular.reduce((s, list) => s + list.length, 0);
    return {
      id: suggestionId("subscriptions", "subscriptions"),
      capability: "subscriptions",
      topic: "subscriptions",
      title: "Go through your subscriptions and cancel the ones you don't use",
      worthCents: Math.round(yearly * R.subscriptionTrimShare),
      worthKind: "saves",
      confidence: evidence("seen", profile.months, count, "subscription charges"),
      urgency: "later",
      why: `You pay about ${formatCents(Math.round(yearly))} a year across ${regular.length} subscriptions; people who look at the list usually drop about a quarter.`,
      action: { label: "Review subscriptions", href: "/subscriptions" },
    };
  },
};

const bankFees: Detector = {
  covers: [],
  capability: "cost",
  topic: "bank_fees",
  needs: [],
  detect({ profile, data }) {
    const fees = tx(
      data,
      (t) =>
        t.pfc === "BANK_FEES_OVERDRAFT_FEES" ||
        t.pfc === "BANK_FEES_INSUFFICIENT_FUNDS" ||
        t.pfc === "BANK_FEES_ATM_FEES",
    );
    if (fees.length < R.feesMin) return null;
    const total = outCents(fees);
    return {
      id: suggestionId("cost", "bank_fees"),
      capability: "cost",
      topic: "bank_fees",
      title: "Stop paying overdraft and bank fees",
      worthCents: total,
      worthKind: "saves",
      confidence: evidence("seen", profile.months, fees.length, "bank fees"),
      urgency: "soon",
      why: `You paid ${formatCents(total)} in ${fees.length} bank fees in ${profile.months} months. A buffer in checking or a no-fee account avoids them.`,
      action: { label: "See the fees", href: "/insights" },
    };
  },
};

const lateFees: Detector = {
  covers: [],
  capability: "cost",
  topic: "late_fees",
  needs: [],
  detect({ profile, data }) {
    const fees = tx(data, (t) => t.pfc === "BANK_FEES_LATE_FEES");
    if (fees.length < R.lateFeesMin) return null;
    const total = outCents(fees);
    return {
      id: suggestionId("cost", "late_fees"),
      capability: "cost",
      topic: "late_fees",
      title: "Set up automatic minimum payments so nothing is late",
      worthCents: total,
      worthKind: "saves",
      confidence: evidence("seen", profile.months, fees.length, "late fees"),
      urgency: "soon",
      why: `You paid ${formatCents(total)} in ${fees.length} late fees. Paying at least the minimum automatically stops them.`,
      action: { label: "Set up payments", href: "/debt" },
    };
  },
};

const cardInterest: Detector = {
  covers: ["card_interest", "credit_cards"],
  capability: "debt",
  topic: "card_interest",
  needs: [],
  detect({ profile, data }) {
    const charges = tx(data, (t) => t.pfc === "BANK_FEES_INTEREST_CHARGE");
    const total = outCents(charges);
    if (total < R.interestMinCents) return null;
    return {
      id: suggestionId("debt", "card_interest"),
      capability: "debt",
      topic: "card_interest",
      title: "Pay down the card that is charging you interest",
      worthCents: total,
      worthKind: "saves",
      confidence: evidence("seen", profile.months, charges.length, "interest charges"),
      urgency: "soon",
      why: `You paid ${formatCents(total)} in card interest over ${profile.months} months; paying the balance off ends it.`,
      action: { label: "Plan the payoff", href: "/debt" },
    };
  },
};

const idleCash: Detector = {
  covers: ["cash_plan"],
  capability: "investing",
  topic: "idle_cash",
  needs: [],
  detect({ profile, data }) {
    const spend = monthlySpendCents(data, profile.months);
    const excess = liquidCents(data) - spend * R.idleMonthsKept;
    if (spend === 0 || excess < R.idleMinExcessCents) return null;
    const accounts = data.accounts.filter((a) => a.type === "depository").length;
    return {
      id: suggestionId("investing", "idle_cash"),
      capability: "investing",
      topic: "idle_cash",
      title: "Put the cash you don't need to work",
      worthCents: Math.round((excess * (R.highYieldBps - R.currentCashBps)) / 10_000),
      worthKind: "earns",
      confidence: evidence("seen", profile.months, accounts, "cash accounts"),
      urgency: "later",
      why: `You keep ${formatCents(liquidCents(data))} in cash and spend about ${formatCents(spend)} a month, so about ${formatCents(excess)} is more than ${R.idleMonthsKept} months of spending.`,
      action: { label: "See where it could work", href: "/investments" },
    };
  },
};

const emergencyFund: Detector = {
  covers: ["goals"],
  capability: "safe_to_spend",
  topic: "emergency_fund",
  needs: ["income_pattern"],
  detect({ profile, data }) {
    const spend = monthlySpendCents(data, profile.months);
    const pattern = profile.facts.income_pattern;
    const months =
      pattern.value === "uneven" || pattern.value === "business"
        ? R.emergencyMonthsUneven
        : R.emergencyMonthsSteady;
    const need = spend * months;
    const short = need - liquidCents(data);
    if (spend === 0 || short <= 0) return null;
    return {
      id: suggestionId("safe_to_spend", "emergency_fund"),
      capability: "safe_to_spend",
      topic: "emergency_fund",
      title: "Build a cushion for emergencies",
      worthCents: short,
      worthKind: "risk",
      confidence: weakest([
        evidence("seen", profile.months, data.accounts.length, "accounts"),
        factEvidence(pattern),
      ]),
      urgency: "soon",
      why: `You spend about ${formatCents(spend)} a month and keep ${formatCents(liquidCents(data))} in cash; ${months} months is ${formatCents(need)}.`,
      action: { label: "Set a savings goal", href: "/goals" },
    };
  },
};

const highCostLoans: Detector = {
  covers: ["debt_trouble"],
  capability: "debt",
  topic: "high_cost_loans",
  needs: [],
  detect({ profile, data }) {
    const payments = tx(
      data,
      (t) => t.pfc === "LOAN_PAYMENTS_CASH_ADVANCES" || t.pfc === "LOAN_PAYMENTS_EWA",
    );
    if (payments.length === 0) return null;
    const repaid = outCents(payments);
    return {
      id: suggestionId("debt", "high_cost_loans"),
      capability: "debt",
      topic: "high_cost_loans",
      title: "Replace the payday loan with something cheaper",
      worthCents: Math.round(repaid * R.paydayFeeShare),
      worthKind: "saves",
      confidence: evidence("seen", profile.months, payments.length, "cash-advance repayments"),
      urgency: "now",
      why: `You repaid ${formatCents(repaid)} in cash-advance loans in ${profile.months} months; their fees are typically about a quarter of that.`,
      action: { label: "See cheaper options", href: "/debt" },
    };
  },
};

const debtPlan: Detector = {
  covers: ["payoff_plan", "debts"],
  capability: "debt",
  topic: "debt_plan",
  needs: [],
  detect({ profile, data }) {
    const trouble = profile.facts.debt_trouble;
    if (trouble.value !== true) return null;
    const interest = outCents(tx(data, (t) => t.pfc === "BANK_FEES_INTEREST_CHARGE"));
    return {
      id: suggestionId("debt", "debt_plan"),
      capability: "debt",
      topic: "debt_plan",
      title: "Make a plan to pay your debts off, biggest interest first",
      worthCents: interest,
      worthKind: "saves",
      confidence: factEvidence(trouble),
      urgency: "now",
      why: `Your cards hold ${formatCents(profile.facts.card_debt_cents.value as number)} and cost you ${formatCents(interest)} in interest a year.`,
      action: { label: "Plan the payoff", href: "/debt" },
    };
  },
};

const hardshipPlan: Detector = {
  covers: ["debt_trouble"],
  capability: "debt",
  topic: "hardship_plan",
  needs: [],
  detect({ profile, data }) {
    const trouble = profile.facts.debt_trouble;
    if (trouble.value !== true) return null;
    const costs = outCents(tx(data, (t) => (t.pfc ?? "").startsWith("BANK_FEES_")));
    return {
      id: suggestionId("debt", "hardship_plan"),
      capability: "debt",
      topic: "hardship_plan",
      title: "Ask your lenders for a hardship plan",
      worthCents: costs,
      worthKind: "risk",
      confidence: factEvidence(trouble),
      urgency: "now",
      why: `Fees and interest cost you ${formatCents(costs)} in ${profile.months} months. Lenders often lower rates or waive fees for people who ask.`,
      action: { label: "Ask for a hardship plan", href: "/debt" },
    };
  },
};

export const MONEY_DETECTORS: readonly Detector[] = [
  subscriptions,
  bankFees,
  lateFees,
  cardInterest,
  idleCash,
  emergencyFund,
  highCostLoans,
  debtPlan,
  hardshipPlan,
];
