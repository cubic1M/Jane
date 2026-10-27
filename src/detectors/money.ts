import { DEBT_DETECTOR_RATES as D } from "@/config/detectors-debt";
import {
  BANK_FEE_CATEGORIES,
  IDLE_CASH_MONTHS_OF_SPENDING,
  PROCESSOR_FEE_PAYEE,
} from "@/config/detection";
import { bankFeesYear } from "@/planning/bank-fees";
import { idleCashOf } from "@/planning/idle-cash";
import { DETECTOR_RATES as R } from "@/config/detectors";
import { emergencyTarget } from "@/planning/emergency-fund";
import { summarize } from "@/planning/costly-borrowing";
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
  headlineOf,
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
    // The person's subscriptions as the subscriptions page and the chat count them, when the
    // loader gave them; the sample people's are found from the charges here.
    const given = data.extras?.subscriptions;
    let yearly: number;
    let count: number;
    let n: number;
    // The charges themselves, for what to watch afterwards (each one that stops is a saving).
    const named = new Map<string, number[]>();
    for (const t of tx(
      data,
      (x) =>
        x.amountCents > 0 &&
        x.amountCents < R.subscriptionMaxCents &&
        SUBSCRIPTION_CATEGORIES.has(x.pfc ?? ""),
    ))
      named.set(t.description, [...(named.get(t.description) ?? []), t.amountCents]);
    const payees = [...named.entries()]
      .filter(([, list]) => list.length >= R.subscriptionMinCharges)
      .map(([description, list]) => ({
        description,
        amountCents: Math.round(list.reduce((a, b) => a + b, 0) / list.length),
        perYear: 12,
      }));
    if (given !== undefined) {
      if (given === null || given.count < R.subscriptionsMin) return null;
      yearly = given.yearlyCents;
      count = given.count;
      n = given.count;
    } else {
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
      const regular = [...byName.values()].filter(
        (list) => list.length >= R.subscriptionMinCharges,
      );
      if (regular.length < R.subscriptionsMin) return null;
      yearly = regular.reduce(
        (s, list) => s + (list.reduce((a, b) => a + b, 0) / list.length) * 12,
        0,
      );
      count = regular.length;
      n = regular.reduce((s, list) => s + list.length, 0);
    }
    return {
      id: suggestionId("subscriptions", "subscriptions"),
      capability: "subscriptions",
      topic: "subscriptions",
      title: "Go through your subscriptions and cancel the ones you don't use",
      headline: headlineOf(
        "Cancel subscriptions you don't use",
        Math.round(yearly * R.subscriptionTrimShare),
        "saves",
      ),
      short: `You pay about ${formatCents(Math.round(yearly))} a year across ${count} subscriptions.`,
      worthCents: Math.round(yearly * R.subscriptionTrimShare),
      worthKind: "saves",
      confidence: evidence("seen", profile.months, n, "subscription charges"),
      urgency: "later",
      why: `You pay about ${formatCents(Math.round(yearly))} a year across ${count} subscriptions; people who look at the list usually drop about a quarter.`,
      action: { label: "Review subscriptions", href: "/subscriptions" },
      ...(payees.length > 0 ? { watch: { kind: "charge_stops" as const, payees } } : {}),
    };
  },
};

const bankFees: Detector = {
  covers: [],
  capability: "cost",
  topic: "bank_fees",
  needs: [],
  detect({ profile, data }) {
    // A year of fees, the one definition (src/planning/bank-fees.ts) the chat's answer uses too.
    const fees = bankFeesYear(data.transactions, profile.months);
    if (!fees || fees.count < R.feesMin) return null;
    const total = fees.yearCents;
    const span = fees.estimated
      ? `${fees.count} bank fees in ${fees.monthsOfData} months, about ${formatCents(total)} over a year (an estimate)`
      : `${formatCents(total)} in ${fees.count} bank fees in the last 12 months`;
    return {
      id: suggestionId("cost", "bank_fees"),
      capability: "cost",
      topic: "bank_fees",
      title: "Stop paying overdraft and bank fees",
      headline: headlineOf("Stop paying overdraft and bank fees", total, "saves"),
      short: fees.estimated
        ? `You paid ${formatCents(fees.seenCents)} in ${fees.count} bank fees in ${fees.monthsOfData} months.`
        : `You paid ${formatCents(total)} in ${fees.count} bank fees in a year.`,
      worthCents: total,
      worthKind: "saves",
      confidence: evidence("seen", profile.months, fees.count, "bank fees"),
      urgency: "soon",
      why: `You paid ${span}. A buffer in checking or a no-fee account avoids them.`,
      action: { label: "See the fees", href: "/insights" },
      watch: {
        kind: "fee_stops",
        pfcs: [...BANK_FEE_CATEGORIES],
        monthlyCents: Math.round(total / 12),
      },
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
      headline: headlineOf("Pay at least the minimum automatically", total, "saves"),
      short: `You paid ${formatCents(total)} in ${fees.length} late fees.`,
      worthCents: total,
      worthKind: "saves",
      confidence: evidence("seen", profile.months, fees.length, "late fees"),
      urgency: "soon",
      why: `You paid ${formatCents(total)} in ${fees.length} late fees. Paying at least the minimum automatically stops them.`,
      action: { label: "Set up payments", href: "/debt" },
      watch: {
        kind: "fee_stops",
        pfcs: ["BANK_FEES_LATE_FEES"],
        monthlyCents: Math.round(total / Math.max(1, profile.months)),
      },
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
    // A year of interest from the cards' balances and rates when known (the loans page and the
    // chat's figure); otherwise the interest charges seen, over the months of data.
    const yearly = data.extras?.cardInterestYearCents;
    const total = typeof yearly === "number" ? yearly : outCents(charges);
    if (total < R.interestMinCents) return null;
    return {
      id: suggestionId("debt", "card_interest"),
      capability: "debt",
      topic: "card_interest",
      title: "Pay down the card that is charging you interest",
      headline: headlineOf("Pay down the card charging interest", total, "saves"),
      short:
        typeof yearly === "number"
          ? `Your cards cost you about ${formatCents(total)} a year in interest.`
          : `You paid ${formatCents(total)} in card interest over ${profile.months} months.`,
      worthCents: total,
      worthKind: "saves",
      confidence: evidence("seen", profile.months, charges.length, "interest charges"),
      urgency: "soon",
      ...(profile.facts.debt_trouble.value === true
        ? { rankCents: Math.round(total * D.troubleDiscount) }
        : {}),
      why: `${
        typeof yearly === "number"
          ? `At your balances and rates your cards cost about ${formatCents(total)} a year in interest`
          : `You paid ${formatCents(total)} in card interest over ${profile.months} months`
      }; ${
        profile.facts.debt_trouble.value === true
          ? "a payoff plan that starts with the highest rate stops it, a card at a time"
          : "paying the balance off ends it"
      }.`,
      action: { label: "Cut your card interest", href: "/loans/interest" },
      watch: {
        kind: "fee_stops",
        pfcs: ["BANK_FEES_INTEREST_CHARGE"],
        monthlyCents:
          typeof yearly === "number"
            ? Math.round(total / 12)
            : Math.round(total / Math.max(1, profile.months)),
      },
    };
  },
};

const idleCash: Detector = {
  covers: ["cash_plan"],
  capability: "investing",
  topic: "idle_cash",
  needs: [],
  detect({ profile, data }) {
    // The one definition (src/planning/idle-cash.ts), the same as the Today card and the chat.
    const idle = idleCashOf({
      asOf: data.today,
      accounts: data.accounts,
      transactions: data.transactions,
    });
    if (!idle) return null;
    return {
      id: suggestionId("investing", "idle_cash"),
      capability: "investing",
      topic: "idle_cash",
      title: "Put the cash you don't need to work",
      headline: headlineOf("Move idle cash to higher interest", idle.earnsCents, "earns"),
      short: `You keep ${formatCents(idle.balanceCents)} in cash; about ${formatCents(idle.excessCents)} is more than you need.`,
      worthCents: idle.earnsCents,
      worthKind: "earns",
      confidence: evidence("seen", profile.months, idle.accountIds.length, "cash accounts"),
      urgency: "later",
      why: `You keep ${formatCents(idle.balanceCents)} in cash and spend about ${formatCents(idle.monthlyCents)} a month, so about ${formatCents(idle.excessCents)} is more than ${IDLE_CASH_MONTHS_OF_SPENDING} months of spending.`,
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
    const trouble = profile.facts.debt_trouble;
    const incomeFact = profile.facts.monthly_income;
    // Sized for this person (src/planning/emergency-fund.ts): more when pay moves around, a
    // small starter buffer in debt trouble, the spending gap for a pension, never one size.
    const target = emergencyTarget({
      spendingCents: spend,
      incomeCents: typeof incomeFact.value === "number" ? incomeFact.value : null,
      pattern: typeof pattern.value === "string" ? pattern.value : null,
      debtTrouble: trouble.value === true,
    });
    if (!target) return null;
    const short = target.targetCents - liquidCents(data);
    if (short <= 0) return null;
    const starter = target.kind === "starter";
    const gap = target.kind === "gap";
    return {
      id: suggestionId("safe_to_spend", "emergency_fund"),
      capability: "safe_to_spend",
      topic: "emergency_fund",
      title: starter
        ? "Put a small starter buffer aside before you tackle the debt"
        : gap
          ? "Keep cash for the gap between your income and your spending"
          : "Build a cushion for emergencies",
      headline: headlineOf(
        starter
          ? "Set a small buffer aside first"
          : gap
            ? "Keep cash for your income gap"
            : "Build an emergency cushion",
        short,
        "risk",
      ),
      short: `You keep ${formatCents(liquidCents(data))} in cash; a cushion for you is ${formatCents(target.targetCents)}.`,
      worthCents: short,
      worthKind: "risk",
      confidence: weakest([
        evidence("seen", profile.months, data.accounts.length, "accounts"),
        // Unknown on a short history: the cushion is then the usual size, so it isn't evidence
        // against it (accuracy bench: "I'm not sure (0%)" with two months of data).
        ...(pattern.value !== null ? [factEvidence(pattern)] : []),
        ...(starter ? [factEvidence(trouble)] : []),
        ...(gap ? [factEvidence(incomeFact)] : []),
      ]),
      urgency: "soon",
      why: starter
        ? `Your cash is ${formatCents(liquidCents(data))} and your debts are the priority, so start with a ${formatCents(target.targetCents)} buffer so a surprise doesn't go on a card; then the debt plan.`
        : gap
          ? `You spend about ${formatCents(spend)} a month against ${formatCents(Number(incomeFact.value))} coming in, a gap of ${formatCents(spend - Number(incomeFact.value))}; ${target.months} months of it is ${formatCents(target.targetCents)}, and you keep ${formatCents(liquidCents(data))}.`
          : `You spend about ${formatCents(spend)} a month and keep ${formatCents(liquidCents(data))} in cash; ${target.months} months is ${formatCents(target.targetCents)}.`,
      action: { label: "Set a savings goal", href: "/goals" },
    };
  },
};

const highCostLoans: Detector = {
  covers: ["debt_trouble", "costly_borrowing"],
  capability: "debt",
  topic: "high_cost_loans",
  needs: [],
  detect({ profile, data }) {
    // The same planner as the costly borrowing page (spec step 247), so the figures agree:
    // payday loans and pay advance apps only (cash advances and overdrafts have their own).
    const cards = new Set(data.accounts.filter((a) => a.type === "credit").map((a) => a.id));
    const costly = summarize(
      data.transactions.map((t, i) => ({
        id: String(i),
        date: t.date,
        amountCents: t.amountCents,
        description: t.description,
        pfcDetailed: t.pfc,
        card: cards.has(t.accountId),
      })),
      data.today,
    );
    const kinds = costly.kinds.filter((k) => k.kind === "payday" || k.kind === "pay_app");
    const cost = kinds.reduce((s, k) => s + k.costCents, 0);
    const count = kinds.reduce((s, k) => s + k.count, 0);
    if (count === 0 || cost <= 0) return null;
    const payday = kinds.some((k) => k.kind === "payday");
    const what = payday ? "payday loans" : "pay advances";
    return {
      id: suggestionId("debt", "high_cost_loans"),
      capability: "debt",
      topic: "high_cost_loans",
      title: payday
        ? "Replace the payday loan with something cheaper"
        : "Replace the pay advance app with something cheaper",
      headline: headlineOf(
        payday ? "Replace your payday loan" : "Replace your pay advances",
        cost,
        "saves",
      ),
      short: `Your ${what} cost about ${formatCents(cost)} in fees in ${profile.months} months.`,
      worthCents: cost,
      worthKind: "saves",
      confidence: evidence("seen", profile.months, count, what),
      urgency: "now",
      why: `Your ${what} cost about ${formatCents(cost)} in fees in ${profile.months} months${costly.cycle ? ", taken again and again" : ""}. A credit union small loan or a pay advance from work costs far less.`,
      action: { label: "See cheaper options", href: "/loans/costly" },
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
    const charges = tx(data, (t) => t.pfc === "BANK_FEES_INTEREST_CHARGE");
    const interest = outCents(charges);
    // With no card linked the card debt isn't known (src/profile/build.ts), so the plan speaks of
    // the interest alone and doesn't rest on the unknown balance (QA: "Your cards hold $0.00").
    const card = profile.facts.card_debt_cents;
    const cards = typeof card.value === "number" ? card.value : null;
    const held = cards === null ? "Your debts" : `Your cards hold ${formatCents(cards)} and`;
    return {
      id: suggestionId("debt", "debt_plan"),
      capability: "debt",
      topic: "debt_plan",
      title: "Make a plan to pay your debts off, biggest interest first",
      headline: headlineOf("Pay off debt, highest interest first", interest, "saves"),
      short: `${held} cost you ${formatCents(interest)} a year.`,
      worthCents: interest,
      worthKind: "saves",
      // The plan rests on the debts themselves: the card balances and the interest they charge
      // (loans QA: it cited the overdraft fees that made it trouble, which say nothing of them).
      confidence: weakest([
        ...(cards === null ? [] : [factEvidence(card)]),
        evidence("seen", profile.months, charges.length, "interest charges"),
      ]),
      urgency: "now",
      rankCents: Math.round(interest * D.troublePlanRank),
      why: `${held} cost you ${formatCents(interest)} in interest a year.`,
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
      headline: headlineOf("Ask lenders for a hardship plan", costs, "risk"),
      short: `Fees and interest cost you ${formatCents(costs)} in ${profile.months} months.`,
      worthCents: costs,
      worthKind: "risk",
      confidence: factEvidence(trouble),
      urgency: "now",
      rankCents: Math.round(costs * D.troubleHardshipRank),
      why: `Fees and interest cost you ${formatCents(costs)} in ${profile.months} months. Lenders often lower rates or waive fees for people who ask.`,
      action: { label: "See your options", href: "/loans/help" },
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
