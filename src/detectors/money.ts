import { plural } from "@/lib/plural";
import { DEBT_DETECTOR_RATES as D } from "@/config/detectors-debt";
import { rateMonthsOf } from "@/profile/build";
import { BANK_FEE_CATEGORIES, IDLE_CASH_MONTHS_OF_SPENDING } from "@/config/detection";
import { bankFeesYear, isBankFee } from "@/planning/bank-fees";
import { LOOKBACK_MONTHS } from "@/config/detection";
import { feeMonthsOf, paceOf } from "@/detection/rules/fee-totals";
import { inList, lookbackEnd } from "@/detection/helpers";
import { monthsBefore } from "@/detection/units";
import { idleCashOf, payingCardInterest } from "@/planning/idle-cash";
import { DETECTOR_RATES as R } from "@/config/detectors";
import { emergencyTarget } from "@/planning/emergency-fund";
import { summarize, TITLE_LOAN_NAMES } from "@/planning/costly-borrowing";
import { formatCents, formatWholeDollars } from "@/lib/money";
import { type Detector, suggestion } from "./contract";
import {
  cashLine,
  cushionSpendCents,
  evidence,
  factEvidence,
  cashKnown,
  liquidCents,
  outCents,
  statementsTooOld,
  tx,
  weakest,
  headlineOf,
} from "./helpers";
import { stoppedEmployer } from "./life";
import { cashClearsCard } from "./student-money";
import { isWaivableMonthlyFee, waivableFee } from "./cover-facts";
import { CHASE_OVERDRAFT, OVERDRAFT_OPT_IN } from "@/config/student-money";

// Detectors for everyday money (spec step 254): subscriptions, fees, card interest, idle
// cash, the emergency fund and debt in trouble. Pure; see ./contract.ts.

export const SUBSCRIPTION_CATEGORIES = new Set([
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
    return suggestion("subscriptions", "subscriptions", {
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
    });
  },
};

const bankFees: Detector = {
  covers: [],
  capability: "cost",
  topic: "bank_fees",
  needs: [],
  detect({ profile, data }) {
    // A year of fees, the one definition (src/planning/bank-fees.ts) over the one count of months
    // (feeMonthsOf) the report's findings and the chat's answer use too (gate B).
    const cash = new Set(data.accounts.filter((a) => a.type === "depository").map((a) => a.id));
    const fees = bankFeesYear(
      data.transactions.map((t) => ({ ...t, onCash: cash.has(t.accountId) })),
      (accountId) =>
        feeMonthsOf({ transactions: data.transactions, asOf: data.today }, [accountId]),
    );
    // Any fee the report finds, as the report finds it (gate B, 11-16: one $35 overdraft was a
    // report finding and "Money found $35/yr" but under this card's old two-fee floor, so the
    // Spending tree, which lists the dock's cards, said nothing). The report's rule is the right one:
    // one fee is money lost, often given back for the asking, and it counts once, not at a pace
    // (FEE_PACE_MIN_CHARGES), so a single fee never reads as a yearly habit.
    if (!fees) return null;
    // A monthly fee the person's own pay may already waive is fee_waiver_met's to say, with the
    // bank's rule: when it's the only fee, one card, not two at the same $144 (debugger 11-18).
    const waivable = waivableFee(data);
    if (
      waivable &&
      data.transactions
        .filter(
          (t) =>
            t.amountCents > 0 &&
            isBankFee({ description: t.description, pfc: t.pfc, onCash: cash.has(t.accountId) }),
        )
        .every((t) => isWaivableMonthlyFee(t, waivable))
    )
      return null;
    const total = fees.yearCents;
    // Night QA 10-30: a traveller's foreign-transaction and annual card fees read as "Stop paying
    // overdraft and bank fees" though nothing was ever overdrawn.
    const overdrafts = data.transactions.filter(
      (t) =>
        t.amountCents > 0 &&
        (t.pfc === "BANK_FEES_OVERDRAFT_FEES" || t.pfc === "BANK_FEES_INSUFFICIENT_FUNDS"),
    );
    const overdrawn = overdrafts.length > 0;
    // An overdraft fee at Chase: Chase's own rule on when it charges one (src/config/student-money.ts).
    const atChase = overdrafts.some((t) => {
      const a = data.accounts.find((x) => x.id === t.accountId);
      return (
        !!a && CHASE_OVERDRAFT.words.test(`${a.institution ?? ""} ${a.name ?? ""}`.toUpperCase())
      );
    });
    // "Card" only when there's a card fee: one on a card, or a foreign-transaction or annual fee
    // (debug 2, 11-17: a checking account's $12 monthly maintenance fee read as "bank and card fees").
    const cardFee = data.transactions.some(
      (t) =>
        t.amountCents > 0 &&
        inList(t.pfc, BANK_FEE_CATEGORIES) &&
        (!cash.has(t.accountId) ||
          t.pfc === "BANK_FEES_FOREIGN_TRANSACTION_FEES" ||
          /\bANNUAL\b/i.test(t.description)),
    );
    const phrase = overdrawn
      ? "Stop paying overdraft and bank fees"
      : cardFee
        ? "Stop paying bank and card fees"
        : "Stop paying bank fees";
    const span = fees.estimated
      ? `${plural(fees.count, "bank fee")} in ${plural(fees.monthsOfData, "month")}, about ${formatCents(total)} over a year (an estimate)`
      : `${formatCents(total)} in ${plural(fees.count, "bank fee")} in the last 12 months`;
    return suggestion("cost", "bank_fees", {
      title: phrase,
      headline: headlineOf(phrase, total, "saves"),
      short: fees.estimated
        ? // Counted as said: "1 bank fees in 1 months" since one fee can make the card (debug 2, 11-16).
          `You paid ${formatCents(fees.seenCents)} in ${plural(fees.count, "bank fee")} in ${plural(fees.monthsOfData, "month")}.`
        : `You paid ${formatCents(total)} in ${plural(fees.count, "bank fee")} in a year.`,
      worthCents: total,
      worthKind: "saves",
      confidence: evidence("seen", profile.months, fees.count, "bank fees"),
      urgency: "soon",
      why: `You paid ${span}. A buffer in checking or a no-fee account avoids them.${
        overdrawn
          ? " The CFPB says banks need your opt-in to charge an overdraft fee on an ATM withdrawal or a one-time debit card purchase, and that you can change that choice any time by asking your bank: the card is then declined instead, with no fee."
          : ""
      }${
        atChase
          ? ` Chase's own rule: no overdraft fee if you're overdrawn by ${formatWholeDollars(CHASE_OVERDRAFT.graceCents)} or less at the end of the business day, or if you bring it back to that by 11 p.m. Eastern the next business day, with a deposit, a transfer or Zelle.`
          : ""
      }`,
      action: { label: "See the fees", href: "/insights" },
      ...(overdrawn
        ? {
            more: [
              { label: "CFPB: overdraft coverage", href: OVERDRAFT_OPT_IN.consumerUrl },
              { label: "The overdraft opt-in rule", href: OVERDRAFT_OPT_IN.url },
              ...(atChase ? [{ label: "Chase's overdraft rules", href: CHASE_OVERDRAFT.url }] : []),
            ],
          }
        : {}),
      watch: {
        kind: "fee_stops",
        pfcs: [...BANK_FEE_CATEGORIES],
        monthlyCents: Math.round(total / 12),
      },
    });
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
    return suggestion("cost", "late_fees", {
      title: "Set up automatic minimum payments so nothing is late",
      headline: headlineOf("Pay at least the minimum automatically", total, "saves"),
      short: `You paid ${formatCents(total)} in ${plural(fees.length, "late fee")}.`,
      worthCents: total,
      worthKind: "saves",
      confidence: evidence("seen", profile.months, fees.length, "late fees"),
      urgency: "soon",
      why: `You paid ${formatCents(total)} in ${plural(fees.length, "late fee")}. Paying at least the minimum automatically stops them.`,
      action: { label: "Set up payments", href: "/debt" },
      watch: {
        kind: "fee_stops",
        pfcs: ["BANK_FEES_LATE_FEES"],
        monthlyCents: Math.round(total / rateMonthsOf(profile)),
      },
    });
  },
};

const cardInterest: Detector = {
  covers: ["card_interest", "credit_cards"],
  capability: "debt",
  topic: "card_interest",
  needs: [],
  detect({ profile, data }) {
    // A year of interest from the cards' balances and rates when known (the loans page and the
    // chat's figure); otherwise the interest charges seen, counted as the report counts them:
    // the last LOOKBACK_MONTHS, at a year's pace when the history is short (debugger 10-30:
    // $141 in four months is the report's "$423 a year", but compared as $141 against a yearly
    // minimum it was no suggestion at all).
    // The same year the pace and the report count: ending where the data does (gate C's calendar
    // sweep, 11-16: from today, "10 interest charges" became 9 as weeks passed with no sync).
    const cutoff = monthsBefore(lookbackEnd(data.transactions, data.today), LOOKBACK_MONTHS);
    const charges = tx(
      data,
      (t) => t.pfc === "BANK_FEES_INTEREST_CHARGE" && t.date > cutoff && t.date <= data.today,
    );
    const known = data.extras?.cardInterestYearCents;
    const unknown = new Set(data.extras?.cardInterestUnknownCards ?? []);
    // Each card's charges at the pace of its own months, as the report's finding on it (debug 3,
    // 11-16: a card's were spread over months only another account's statement covered).
    const history = { transactions: data.transactions, asOf: data.today };
    const pace = (list: typeof charges) =>
      [...new Set(list.map((c) => c.accountId))].reduce((sum, card) => {
        const own = paceOf(history, [card]);
        const cents = outCents(list.filter((c) => c.accountId === card));
        return sum + (own.short ? Math.round((cents * 12) / own.months) : cents);
      }, 0);
    // In words: the months the cards charging it cover.
    const { short, months } = paceOf(history, new Set(charges.map((c) => c.accountId)));
    // Known cards from their balances and rates, plus the unknown ones' charges at their pace
    // (review 10-31: one unknown card made the known ones' $1,500 fall back to $490 seen).
    const yearly =
      typeof known === "number"
        ? known + pace(charges.filter((c) => unknown.has(c.accountId)))
        : null;
    const seen = outCents(charges);
    const total = yearly ?? pace(charges);
    if (total < R.interestMinCents) return null;
    // Cash beyond a month's spending would clear it: card_from_cash says so with its steps.
    if ((cashClearsCard(data)?.interestCents ?? 0) > 0) return null;
    return suggestion("debt", "card_interest", {
      title: "Pay down the card that is charging you interest",
      headline: headlineOf("Pay down the card charging interest", total, "saves"),
      short:
        typeof yearly === "number"
          ? `Your cards cost you about ${formatCents(total)} a year in interest.`
          : `You paid ${formatCents(seen)} in card interest over ${months} months.`,
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
          : `You paid ${formatCents(seen)} in card interest over ${months} months${short ? `, about ${formatCents(total)} a year` : ""}`
      }; ${
        profile.facts.debt_trouble.value === true
          ? "a payoff plan that starts with the highest rate stops it, a card at a time"
          : "paying the balance off ends it"
      }.`,
      action: { label: "Cut your card interest", href: "/loans/interest" },
      watch: {
        kind: "fee_stops",
        pfcs: ["BANK_FEES_INTEREST_CHARGE"],
        monthlyCents: Math.round(total / 12),
      },
    });
  },
};

const idleCash: Detector = {
  covers: ["cash_plan"],
  capability: "investing",
  topic: "idle_cash",
  needs: [],
  detect({ profile, data }) {
    // "You keep $X in cash" says what's held now: not from statements that ended long ago, as the
    // cushion card (debug 3's invariants, 11-19: "You keep $8,450.00 in cash" two months on).
    if (statementsTooOld(data)) return null;
    // The one definition (src/planning/idle-cash.ts), the same as the Today card and the chat.
    const idle = idleCashOf({
      asOf: data.today,
      accounts: data.accounts,
      transactions: data.transactions,
    });
    if (!idle) return null;
    // Not while a card charges far more than a savings rate pays (debugger 11-04).
    if (payingCardInterest({ asOf: data.today, transactions: data.transactions })) return null;
    // Nor is any of it "more than you need" just after a paycheck stopped (debugger 11-04).
    if (stoppedEmployer(data)) return null;
    return suggestion("investing", "idle_cash", {
      title: "Put the cash you don't need to work",
      headline: headlineOf("Move idle cash to higher interest", idle.earnsCents, "earns"),
      short: `You keep ${formatCents(idle.balanceCents)} in cash; about ${formatCents(idle.excessCents)} is more than you need.`,
      worthCents: idle.earnsCents,
      worthKind: "earns",
      confidence: evidence("seen", profile.months, idle.accountIds.length, "cash accounts"),
      urgency: "later",
      why: `You keep ${formatCents(idle.balanceCents)} in cash and spend about ${formatCents(idle.monthlyCents)} a month, so about ${formatCents(idle.excessCents)} is more than ${IDLE_CASH_MONTHS_OF_SPENDING} months of spending.`,
      action: { label: "See where it could work", href: "/investments" },
    });
  },
};

const emergencyFund: Detector = {
  covers: ["goals"],
  capability: "safe_to_spend",
  topic: "emergency_fund",
  needs: ["income_pattern"],
  detect({ profile, data }) {
    // "You keep $X in cash" says what's held now: not from statements that ended long ago.
    if (statementsTooOld(data)) return null;
    const spend = cushionSpendCents(data);
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
    if (!target || !cashKnown(data)) return null;
    const short = target.targetCents - liquidCents(data);
    if (short <= 0) return null;
    const starter = target.kind === "starter";
    const gap = target.kind === "gap";
    return suggestion("safe_to_spend", "emergency_fund", {
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
      short: `${cashLine(liquidCents(data))}; a cushion for you is ${formatCents(target.targetCents)}.`,
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
        ? `${liquidCents(data) < 0 ? `You're ${formatCents(-liquidCents(data))} overdrawn` : `Your cash is ${formatCents(liquidCents(data))}`} and your debts are the priority, so start with a ${formatCents(target.targetCents)} buffer so a surprise doesn't go on a card; then the debt plan.`
        : gap
          ? `You spend about ${formatCents(spend)} a month against ${formatCents(Number(incomeFact.value))} coming in, a gap of ${formatCents(spend - Number(incomeFact.value))}; ${target.months} months of it is ${formatCents(target.targetCents)}. ${cashLine(liquidCents(data))}.`
          : `You spend about ${formatCents(spend)} a month. ${cashLine(liquidCents(data))}; ${target.months} months is ${formatCents(target.targetCents)}.`,
      // The goal form opens drafted with this cushion (src/app/goals/page.tsx); the address names
      // the draft, never an amount (debug 2, 11-16: Yes opened an empty form).
      action: { label: "Set a savings goal", href: "/goals?draft=emergency_fund" },
    });
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
    // A year's worth, as the card shows it: at a year's pace when the history is short, as card
    // interest does (debugger 11-16: "$5/yr" from "$4.89 in fees in 6 months). Over the months the
    // cash accounts cover, where advances land and are paid back, not a card's (debug 3, 11-16).
    const cash = data.accounts.filter((a) => !cards.has(a.id)).map((a) => a.id);
    const { short, months } = paceOf(
      { transactions: data.transactions, asOf: data.today },
      cash.length > 0 ? cash : undefined,
    );
    const yearly = short ? Math.round((cost * 12) / months) : cost;
    const seen = `${formatCents(cost)} in fees in ${months === 1 ? "a month" : `${months} months`}`;
    const payday = kinds.some((k) => k.kind === "payday");
    const titleLoan = data.transactions.some(
      (t) => t.amountCents > 0 && TITLE_LOAN_NAMES.test(t.description),
    );
    const what = titleLoan ? "costly loans" : payday ? "payday loans" : "pay advances";
    const loan = titleLoan ? "title loan" : "payday loan";
    return suggestion("debt", "high_cost_loans", {
      title: payday
        ? `Replace the ${loan} with something cheaper`
        : "Replace the pay advance app with something cheaper",
      headline: headlineOf(
        payday ? `Replace your ${loan}` : "Replace your pay advances",
        yearly,
        "saves",
      ),
      short: `Your ${what} cost about ${seen}${short ? `, about ${formatCents(yearly)} a year` : ""}.`,
      worthCents: yearly,
      worthKind: "saves",
      // A title loan's count is its payments: "7 costly loans" was one loan and one payday loan.
      confidence: evidence(
        "seen",
        profile.months,
        count,
        titleLoan ? "costly loan payments" : what,
      ),
      urgency: "now",
      why: `Your ${what} cost about ${seen}${short ? ` (about ${formatCents(yearly)} a year at that pace)` : ""}${costly.cycle ? ", taken again and again" : ""}. A credit union small loan or a pay advance from work costs far less.`,
      action: { label: "See cheaper options", href: "/loans/costly" },
    });
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
    // No interest in the accounts: nothing for "biggest interest first" to stand on.
    if (interest === 0) return null;
    // With no card linked the card debt isn't known (src/profile/build.ts), so the plan speaks of
    // the interest alone and doesn't rest on the unknown balance (QA: "Your cards hold $0.00").
    const card = profile.facts.card_debt_cents;
    const cards = typeof card.value === "number" ? card.value : null;
    const held = cards === null ? "Your debts" : `Your cards hold ${formatCents(cards)} and`;
    return suggestion("debt", "debt_plan", {
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
    });
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
    // The reason in their own figures; with no fees or interest, what made it trouble.
    const said =
      costs > 0
        ? `Fees and interest cost you ${formatCents(costs)} in ${plural(profile.months, "month")}.`
        : "Your debt payments take more of your income than lenders like to see.";
    return suggestion("debt", "hardship_plan", {
      title: "Ask your lenders for a hardship plan",
      headline: headlineOf("Ask lenders for a hardship plan", costs, "risk"),
      short: said,
      worthCents: costs,
      worthKind: "risk",
      confidence: factEvidence(trouble),
      urgency: "now",
      rankCents: Math.round(costs * D.troubleHardshipRank),
      why: `${said} Lenders often lower rates or waive fees for people who ask.`,
      action: { label: "See your options", href: "/loans/help" },
    });
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
