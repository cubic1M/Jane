import {
  CLOSED_CARD_YEARS,
  INVEST_RANGE,
  KEEP_CASH_MONTHS,
  RENT_BUY_YEARS,
  SAVE_SHARE,
  PAYDAY,
  USE_GOOD,
  paydayAprPercent,
} from "@/config/debt-decisions";
import { formatCents } from "@/lib/money";

// Straight answers to the debt and credit decisions people ask about, in three sentences or
// fewer, from the person's own numbers. Pure. The comparison is always stated; the pick
// ("I'd pay it first") only when `advice` is on (demo advice mode), otherwise it ends at the
// math.

export type DecisionCard = {
  name: string;
  balanceCents: number;
  aprBps: number | null;
  limitCents: number | null;
};
export type DecisionLoan = {
  name: string;
  balanceCents: number;
  aprBps: number | null;
};

export type DecisionInput = {
  advice: boolean;
  cards: readonly DecisionCard[];
  mortgage: DecisionLoan | null;
  student: DecisionLoan | null;
  // The total of the card limits the credit report shows, when known.
  totalLimitCents?: number | null;
  // Cash in checking and savings, and a typical month of spending.
  liquidCents: number;
  monthlySpendCents: number;
  // The best way found to move card debt for less, with what it would save in all.
  // The fit engine's pick for the cards as one personal loan, when it saves.
  // The fit engine found that cash alone clears the cards for less than any loan: what that saves.
  cashPayoffSavesCents?: number | null;
  personalLoan?: { name: string; kind: "personal"; aprBps: number; savesCents: number } | null;
  consolidation: {
    name: string;
    kind: "transfer" | "personal";
    aprBps: number;
    savesCents: number;
  } | null;
  // A 0% transfer that would have saved, left out because the score is under what those cards
  // usually need (TRANSFER_MIN_SCORE); null when none was left out.
  transferNeedsScore?: { score: number; minScore: number } | null;
  // The next payday, for a payday loan question.
  nextPayday: { date: string; days: number } | null;
  // Checking over the next month, day by day, with the bills and installments in it; and the
  // cash in savings that could cover a dip.
  forecast?: {
    firstNegative: { date: string; balanceCents: number } | null;
    lowest: { date: string; balanceCents: number } | null;
    savingsCents: number;
  } | null;
  // Take-home pay a month and what is left after spending, from the last full months.
  incomeCents?: number | null;
  savingCents?: number | null;
  // What they pay in rent, and the home the 28/36 rules would allow: its price, its monthly
  // cost with taxes and insurance, and the cash needed up front.
  rentCents?: number | null;
  home?: { maxPriceCents: number; housingCents: number; cashNeededCents: number } | null;
  // Buy now, pay later plans the person has, and what they pay a month on them.
  bnpl?: { plans: number; monthlyCents: number } | null;
};

export type DecisionId =
  | "pay_or_invest"
  | "consolidate"
  | "savings_or_debt"
  | "close_card"
  | "payoff_hurts"
  | "personal_loan"
  | "payday_loan"
  | "student_early"
  | "overdraft"
  | "bnpl"
  | "save_each_month"
  | "rent_or_buy";

export type Decision = {
  id: DecisionId;
  // Up to three sentences, in order: the answer, the person's numbers, the next step.
  sentences: string[];
  // The page with the detail.
  href: string;
  // Needs demo advice labelling: the answer picks one.
  advice: boolean;
  // Nothing was weighed (no debt, or no rate to work with), so there's no confidence to show.
  nothingWeighed?: true;
};

const pct = (bps: number) => {
  const s = (bps / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${s}%`;
};
const rated = (cards: readonly DecisionCard[]) =>
  cards.filter((c) => c.balanceCents > 0 && c.aprBps !== null);
const total = (cards: readonly DecisionCard[]) => cards.reduce((s, c) => s + c.balanceCents, 0);
const worst = (cards: readonly DecisionCard[]) =>
  [...rated(cards)].sort((a, b) => (b.aprBps ?? 0) - (a.aprBps ?? 0))[0] ?? null;
const keepCents = (i: DecisionInput) => i.monthlySpendCents * KEEP_CASH_MONTHS;
const spare = (i: DecisionInput) => Math.max(0, i.liquidCents - keepCents(i));
const weightedApr = (cards: readonly DecisionCard[]) => {
  const r = rated(cards);
  const sum = total(r);
  return sum > 0
    ? Math.round(r.reduce((s, c) => s + (c.aprBps ?? 0) * c.balanceCents, 0) / sum)
    : null;
};

const noDebt = (id: DecisionId, href = "/loans"): Decision => ({
  id,
  sentences: ["I don't see a debt with a balance, so there's nothing to pay down."],
  href,
  advice: false,
  nothingWeighed: true,
});

// Cards with a balance but no rate (a CSV import, or a bank that doesn't say): ask for it
// rather than say there's no debt. Falls back to noDebt when there are no cards owing at all.
const noRate = (i: DecisionInput, id: DecisionId, href = "/loans"): Decision => {
  const owing = i.cards.filter((c) => c.balanceCents > 0);
  if (owing.length === 0) return noDebt(id, href);
  return {
    id,
    sentences: [
      owing.length === 1
        ? `You owe ${formatCents(owing[0].balanceCents)} on ${owing[0].name}, but I don't have its rate.`
        : `You owe ${formatCents(total(owing))} across ${owing.length} cards, but I don't have their rates.`,
      "Tell me the rate (it's on the statement, as the purchase APR) and I'll work this out with your numbers.",
    ],
    href: "/loans",
    advice: false,
    nothingWeighed: true,
  };
};

// "Should I pay off my card or invest?" The debt's rate against what investing has returned.
export function payOrInvest(i: DecisionInput): Decision {
  const card = worst(i.cards);
  const debt = card
    ? { name: card.name, balanceCents: card.balanceCents, aprBps: card.aprBps! }
    : i.mortgage && i.mortgage.aprBps !== null && i.mortgage.balanceCents > 0
      ? { name: i.mortgage.name, balanceCents: i.mortgage.balanceCents, aprBps: i.mortgage.aprBps }
      : null;
  if (!debt) return noRate(i, "pay_or_invest");
  const first = `${debt.name} costs ${pct(debt.aprBps)} a year on ${formatCents(debt.balanceCents)}, and ${INVEST_RANGE.note.charAt(0).toLowerCase()}${INVEST_RANGE.note.slice(1)}`;
  const beats = debt.aprBps > INVEST_RANGE.highBps;
  if (!i.advice) {
    return {
      id: "pay_or_invest",
      sentences: [
        first,
        `Paying it down earns exactly ${pct(debt.aprBps)}, certain; investing is a range that can lose.`,
      ],
      href: "/loans/interest",
      advice: false,
    };
  }
  const cash = i.liquidCents < keepCents(i);
  return {
    id: "pay_or_invest",
    sentences: [
      first,
      beats
        ? `Paying it down is a certain ${pct(debt.aprBps)} return, more than investing's usual best, so I'd pay it off first.`
        : `At ${pct(debt.aprBps)} it's near investing's range, so the minimum payment plus investing is reasonable too.`,
      cash
        ? `Keep about ${formatCents(keepCents(i))} in cash before either.`
        : `You can put ${formatCents(Math.min(spare(i), debt.balanceCents))} toward it now and still keep a month of spending.`,
    ],
    href: "/loans/interest",
    advice: true,
  };
}

// "Should I consolidate my debt?"
export function consolidate(i: DecisionInput): Decision {
  const cards = rated(i.cards);
  if (cards.length === 0) return noRate(i, "consolidate");
  const avg = weightedApr(cards)!;
  const first = `You owe ${formatCents(total(cards))} across ${cards.length} ${cards.length === 1 ? "card" : "cards"} at ${pct(avg)} on average.`;
  if (i.cashPayoffSavesCents && i.cashPayoffSavesCents > 0) {
    return {
      id: "consolidate",
      sentences: [
        first,
        `Your cash covers it: paying the cards off from savings would save about ${formatCents(i.cashPayoffSavesCents)} and still leave a month of spending.`,
        ...(i.advice ? ["I'd do that instead of taking a loan."] : []),
      ],
      href: "/loans/refinance",
      advice: i.advice,
    };
  }
  const c = i.consolidation;
  if (!c || c.savesCents <= 0) {
    return {
      id: "consolidate",
      sentences: [
        first,
        i.transferNeedsScore
          ? `A 0% transfer card would cost less, but those usually need a score of ${i.transferNeedsScore.minScore} or more and yours is ${i.transferNeedsScore.score}; no loan beats your rates once fees are counted.`
          : "I don't see an offer that beats your current rates once its fees are counted.",
        ...(i.advice ? ["Paying the highest-rate card first is the cheaper move for now."] : []),
      ],
      href: "/loans/refinance",
      advice: i.advice,
    };
  }
  return {
    id: "consolidate",
    sentences: [
      first,
      `${c.name} at ${pct(c.aprBps)} would save about ${formatCents(c.savesCents)} in all, fees counted.`,
      ...(i.advice
        ? ["It's worth it only if you stop adding to the cards afterward; I'd do it."]
        : ["That's the math; what to do with it is yours to decide."]),
    ],
    href: "/loans/refinance",
    advice: i.advice,
  };
}

// "Should I use my savings to pay off debt?"
export function savingsOrDebt(i: DecisionInput): Decision {
  const card = worst(i.cards);
  if (!card) return noRate(i, "savings_or_debt");
  const extra = Math.min(spare(i), total(i.cards));
  const yearly = Math.round((extra * (card.aprBps ?? 0)) / 10_000);
  const first = `You have ${formatCents(i.liquidCents)} in cash and ${formatCents(total(i.cards))} on cards, the worst at ${pct(card.aprBps!)}.`;
  if (extra <= 0) {
    return {
      id: "savings_or_debt",
      sentences: [
        first,
        `That's under the ${formatCents(keepCents(i))} a month of spending worth keeping, so there's nothing spare to put on the card.`,
      ],
      href: "/loans/interest",
      advice: i.advice,
    };
  }
  return {
    id: "savings_or_debt",
    sentences: [
      first,
      `Putting ${formatCents(extra)} on ${card.name} saves about ${formatCents(yearly)} a year in interest and still leaves a month of spending.`,
      ...(i.advice ? ["Savings earn less than the card costs, so I'd do it."] : []),
    ],
    href: "/loans/interest",
    advice: i.advice,
  };
}

// "Should I close a credit card?"
export function closeCard(i: DecisionInput): Decision {
  const withLimit = i.cards.filter((c) => c.limitCents);
  const limit = withLimit.reduce((s, c) => s + (c.limitCents ?? 0), 0);
  const owed = withLimit.reduce((s, c) => s + c.balanceCents, 0);
  if (withLimit.length === 0 && i.totalLimitCents && i.totalLimitCents > 0 && i.cards.length > 0) {
    const use = Math.round((total(i.cards) / i.totalLimitCents) * 100);
    return {
      id: "close_card",
      sentences: [
        `You use ${use}% of your ${formatCents(i.totalLimitCents)} in card limits, and closing any card lowers that limit and raises the percentage.`,
        `A closed card in good standing stays on your report for about ${CLOSED_CARD_YEARS} years, but the lower limit is what usually costs points.`,
        ...(i.advice ? ["I'd keep it open unless it charges a fee."] : []),
      ],
      href: "/loans/credit",
      advice: i.advice,
    };
  }
  if (withLimit.length === 0) {
    return {
      id: "close_card",
      sentences: [
        "Closing a card lowers your total limit, which raises how much of it you use and can lower your score.",
        "I don't know your card limits yet, so I can't say by how much.",
      ],
      href: "/loans/credit",
      advice: false,
    };
  }
  const smallest = [...withLimit].sort((a, b) => (a.limitCents ?? 0) - (b.limitCents ?? 0))[0];
  const after = limit - (smallest.limitCents ?? 0);
  const useNow = Math.round((owed / limit) * 100);
  const useAfter = after > 0 ? Math.round((owed / after) * 100) : null;
  return {
    id: "close_card",
    sentences: [
      useAfter === null
        ? `Closing ${smallest.name} would leave you with no card limit at all, and your ${useNow}% use is the main thing a score reads.`
        : `Closing ${smallest.name} would cut your limits from ${formatCents(limit)} to ${formatCents(after)}, taking your card use from ${useNow}% to ${useAfter}%.`,
      `A closed card in good standing stays on your report for about ${CLOSED_CARD_YEARS} years, but the lower limit is what usually costs points.`,
      ...(i.advice
        ? [
            useAfter !== null && useAfter / 100 > USE_GOOD
              ? "I'd keep it open unless it charges a fee."
              : "With use that low, closing it is a small cost; keep it if it has no fee.",
          ]
        : []),
    ],
    href: "/loans/credit",
    advice: i.advice,
  };
}

// "Will paying off a card hurt my credit?"
export function payoffHurts(i: DecisionInput): Decision {
  const withLimit = i.cards.filter((c) => c.limitCents);
  const limit = withLimit.reduce((s, c) => s + (c.limitCents ?? 0), 0);
  const owed = withLimit.reduce((s, c) => s + c.balanceCents, 0);
  const first =
    "No: paying a card off doesn't hurt your credit, it lowers your card use, which helps.";
  return {
    id: "payoff_hurts",
    sentences: [
      first,
      limit > 0
        ? `Paying all your cards off would take your use from ${Math.round((owed / limit) * 100)}% to 0% of ${formatCents(limit)}.`
        : "Only closing the card afterward can cost points, because that lowers your limit.",
      ...(limit > 0 ? ["Only closing a card afterward can cost points, so keep it open."] : []),
    ].slice(0, 3),
    href: "/loans/credit",
    advice: false,
  };
}

// "Should I take a personal loan to pay off my cards?"
export function personalLoan(i: DecisionInput): Decision {
  const cards = rated(i.cards);
  if (cards.length === 0) return noRate(i, "personal_loan");
  const avg = weightedApr(cards)!;
  const c = i.personalLoan ?? null;
  const first = `Your cards average ${pct(avg)} on ${formatCents(total(cards))}.`;
  if (i.cashPayoffSavesCents && i.cashPayoffSavesCents > 0) {
    return {
      id: "personal_loan",
      sentences: [
        first,
        `Your cash covers it: paying the cards off from savings would save about ${formatCents(i.cashPayoffSavesCents)} and still leave a month of spending.`,
        ...(i.advice ? ["I'd do that instead of taking a loan."] : []),
      ],
      href: "/loans/refinance",
      advice: i.advice,
    };
  }
  if (!c || c.savesCents <= 0) {
    return {
      id: "personal_loan",
      sentences: [
        first,
        "I don't see a loan or transfer offer that comes out cheaper after fees.",
        ...(i.advice ? ["Paying the highest-rate card first is the better move."] : []),
      ],
      href: "/loans/refinance",
      advice: i.advice,
    };
  }
  return {
    id: "personal_loan",
    sentences: [
      first,
      `${c.name} at ${pct(c.aprBps)} would save about ${formatCents(c.savesCents)} in all, with its fees counted.`,
      ...(i.advice
        ? ["A fixed payment helps, but only if the cards stay empty afterward."]
        : ["That's the math; the choice is yours."]),
    ],
    href: "/loans/refinance",
    advice: i.advice,
  };
}

// "Should I take a payday loan?"
export function paydayLoan(i: DecisionInput): Decision {
  const apr = paydayAprPercent();
  const first = `A payday loan usually costs about ${Math.round(PAYDAY.feeShare * 100)}% of what you borrow for two weeks, which is around ${apr}% a year.`;
  const when = i.nextPayday
    ? `Your next payday is ${i.nextPayday.date}, ${i.nextPayday.days} ${i.nextPayday.days === 1 ? "day" : "days"} away.`
    : null;
  return {
    id: "payday_loan",
    sentences: [
      first,
      ...(when ? [when] : []),
      i.advice
        ? "A card cash advance, a credit union small loan or an employer pay advance costs far less, so I'd try those first."
        : "A card cash advance, a credit union small loan or a pay advance from your employer usually costs far less.",
    ].slice(0, 3),
    href: "/loans/tight",
    advice: i.advice,
  };
}

// "Should I pay off my student loan early?"
export function studentEarly(i: DecisionInput): Decision {
  const loan = i.student;
  if (!loan || loan.balanceCents <= 0) return noDebt("student_early", "/loans/student");
  if (loan.aprBps === null) {
    return {
      id: "student_early",
      sentences: [
        `You owe ${formatCents(loan.balanceCents)} on ${loan.name}, but I don't have its rate.`,
        "Tell me the rate and I'll compare it with what investing has returned and with your other debts.",
      ],
      href: "/loans/student",
      advice: false,
    };
  }
  const first = `${loan.name} is ${formatCents(loan.balanceCents)} at ${pct(loan.aprBps)}, and ${INVEST_RANGE.note.charAt(0).toLowerCase()}${INVEST_RANGE.note.slice(1)}`;
  if (!i.advice) {
    return {
      id: "student_early",
      sentences: [
        first,
        `Paying it early earns exactly ${pct(loan.aprBps)}, certain; federal loans also carry protections a payoff gives up.`,
      ],
      href: "/loans/student",
      advice: false,
    };
  }
  return {
    id: "student_early",
    sentences: [
      first,
      loan.aprBps > INVEST_RANGE.highBps
        ? "That's above investing's usual best, so extra payments are a good use of money after any card debt."
        : "That's within investing's range, so the minimum payment while you invest or save is reasonable too.",
      "If it's federal and you may qualify for forgiveness, don't pay it off early.",
    ],
    href: "/loans/student",
    advice: true,
  };
}

// "Will I overdraft this month?" From the day-by-day checking forecast.
export function overdraft(i: DecisionInput): Decision {
  const f = i.forecast;
  if (!f?.lowest) {
    return {
      id: "overdraft",
      sentences: [
        "I can't see a checking account to forecast, so I can't say if you'll overdraft.",
      ],
      href: "/loans/tight",
      advice: false,
    };
  }
  if (!f.firstNegative) {
    return {
      id: "overdraft",
      sentences: [
        `No: your checking stays above zero for the next month, dipping lowest to ${formatCents(f.lowest.balanceCents)} on ${f.lowest.date}.`,
        ...(i.nextPayday
          ? [
              `That's with your bills and installments counted, and your next payday is ${i.nextPayday.date}.`,
            ]
          : []),
      ],
      href: "/loans/tight",
      advice: false,
    };
  }
  const gap = -f.firstNegative.balanceCents;
  return {
    id: "overdraft",
    sentences: [
      `Yes: your checking is forecast to go ${formatCents(gap)} below zero on ${f.firstNegative.date}.`,
      f.savingsCents >= gap
        ? `Your savings could cover the ${formatCents(gap)}.`
        : `Your savings of ${formatCents(f.savingsCents)} wouldn't fully cover it.`,
      ...(i.advice
        ? [
            f.savingsCents >= gap
              ? `Move ${formatCents(gap)} over before ${f.firstNegative.date} so no overdraft fee hits.`
              : "Ask each lender to move a due date after payday before it hits.",
          ]
        : []),
    ].slice(0, 3),
    href: "/loans/tight",
    advice: i.advice,
  };
}

// "Should I use buy now pay later?"
export function bnpl(i: DecisionInput): Decision {
  const b = i.bnpl;
  const have =
    b && b.plans > 0
      ? `You have ${b.plans} ${b.plans === 1 ? "plan" : "plans"} now, ${formatCents(b.monthlyCents)} a month in installments.`
      : "You have no buy now, pay later plan right now.";
  return {
    id: "bnpl",
    sentences: [
      "A Pay in 4 plan costs nothing extra if every payment lands on time; a missed one brings late fees and some plans charge interest.",
      have,
      i.advice
        ? "It's fine for something you'd buy anyway when your checking covers every payment; tell me the total and I'll check it against your forecast."
        : "Tell me the total and I'll check it against your forecast.",
    ],
    href: "/loans",
    advice: i.advice,
  };
}

// "How much should I save each month?"
export function saveEachMonth(i: DecisionInput): Decision {
  const income = i.incomeCents;
  if (!income || income <= 0) {
    return {
      id: "save_each_month",
      sentences: [
        "I need to see a few months of income before I can say how much to save each month.",
        "A common target is 20% of what you take home.",
      ],
      href: "/goals",
      advice: false,
    };
  }
  const saving = Math.max(0, i.savingCents ?? 0);
  const target = Math.round(income * SAVE_SHARE);
  const share = Math.round((saving / income) * 100);
  const gap = target - saving;
  const card = worst(i.cards);
  return {
    id: "save_each_month",
    sentences: [
      `You keep about ${formatCents(saving)} a month now, ${share}% of the ${formatCents(income)} you take home.`,
      gap > 0
        ? `A common target is ${Math.round(SAVE_SHARE * 100)}%, ${formatCents(target)} a month, which is ${formatCents(gap)} more than you save now.`
        : `A common target is ${Math.round(SAVE_SHARE * 100)}%, ${formatCents(target)} a month, and you already beat it.`,
      ...(i.advice
        ? [
            card && (card.aprBps ?? 0) > 1_000
              ? `With ${card.name} at ${pct(card.aprBps!)}, put the first ${formatCents(Math.min(Math.max(saving, target), card.balanceCents))} toward it each month before saving elsewhere.`
              : `Build cash for about three months of spending first, then retirement.`,
          ]
        : []),
    ],
    href: "/goals",
    advice: i.advice,
  };
}

// "Should I rent or buy?"
export function rentOrBuy(i: DecisionInput): Decision {
  const h = i.home;
  if (!h) {
    return {
      id: "rent_or_buy",
      sentences: [
        "I need a few months of income to see before I can compare renting with buying.",
        `Buying tends to beat renting only if you stay about ${RENT_BUY_YEARS} years or more.`,
      ],
      href: "/loans/home",
      advice: false,
    };
  }
  const rent = i.rentCents;
  const first = rent
    ? `You pay ${formatCents(rent)} a month in rent; a home up to ${formatCents(h.maxPriceCents)}, the most the usual 28/36 rules allow, would cost about ${formatCents(h.housingCents)} a month with taxes and insurance.`
    : `A home up to ${formatCents(h.maxPriceCents)}, the most the usual 28/36 rules allow, would cost about ${formatCents(h.housingCents)} a month with taxes and insurance.`;
  const second = `You'd also need about ${formatCents(h.cashNeededCents)} up front, and buying tends to beat renting only if you stay ${RENT_BUY_YEARS} years or more.`;
  const diff = rent ? h.housingCents - rent : null;
  return {
    id: "rent_or_buy",
    sentences: [
      first,
      second,
      ...(i.advice && diff !== null
        ? [
            diff > 0
              ? `That's ${formatCents(diff)} a month more than your rent, so renting is cheaper unless you'll stay many years.`
              : `That's no more than your rent each month, so buying makes sense if you'll stay ${RENT_BUY_YEARS} years or more.`,
          ]
        : []),
    ],
    href: "/loans/home",
    advice: i.advice,
  };
}

export const DECISIONS: Readonly<Record<DecisionId, (i: DecisionInput) => Decision>> = {
  pay_or_invest: payOrInvest,
  consolidate,
  savings_or_debt: savingsOrDebt,
  close_card: closeCard,
  payoff_hurts: payoffHurts,
  personal_loan: personalLoan,
  payday_loan: paydayLoan,
  student_early: studentEarly,
  overdraft,
  bnpl,
  save_each_month: saveEachMonth,
  rent_or_buy: rentOrBuy,
};
