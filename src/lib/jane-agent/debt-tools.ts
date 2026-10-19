import type Anthropic from "@anthropic-ai/sdk";
import { sourceLabel, type DebtBook } from "@/insights/debts";
import { formatRate } from "@/insights/loans";
import { MAX_DEBT_EXTRA_CENTS } from "@/config/debt";
import type { Payoff } from "@/lib/debt-plan";
import { statusLine, type LoanApplicationView } from "@/lib/loan-application-status";
import type { Transfers } from "@/lib/balance-transfers";
import type { Refinance } from "@/lib/refinance";
import type { StudentLoans } from "@/lib/student-loans";
import type { Mortgage } from "@/lib/mortgage";
import type { Credit } from "@/lib/credit";
import type { DebtAutopilot } from "@/lib/debt-autopilot";
import { PMI_SOURCE } from "@/config/debt";
import { PMI_STEPS } from "@/planning/mortgage";
import { STUDENT_SOURCES, STUDENT_STEPS } from "@/config/student-loans";
import { PLAN_NAMES } from "@/planning/student-loans";
import type { PayoffPlan } from "@/planning/debt";
import type { ScoredOffer } from "@/planning/refinance";
import { monthAfter } from "@/planning/payoff";

// Claude's tools about debts in Jane's chat (spec Phase Y): read-only, over the same debt
// book as the loans page (src/lib/debts.ts). Every dollar figure goes through `money`, so
// the guardrails know it came from a tool (./claude-tools.ts).

const noInput = { type: "object" as const, properties: {}, additionalProperties: false };

export const REFINANCE_TOOL: Anthropic.Tool = {
  name: "refinance_offers",
  description:
    "Refinance offers Jane checked for the person's loans and cards (sample offers from a stand-in lender catalog; only demo-bank people have any). For each debt: the balance, rate and months left, what keeping it costs over those months, each offer's rate, monthly payment, total over the same months with fees, saving, and break-even months for a fee; Jane's pick and why when one saves enough to switch. Nothing has been applied for.",
  input_schema: noInput,
};

export const DEBT_TOOLS: Anthropic.Tool[] = [
  {
    name: "debts",
    description:
      "Every debt the person has: loans and cards from their bank, buy now, pay later plans found from their payments, and terms they typed. For each: balance, rate (and where it came from: their bank, they typed it, the plan's terms, or not known), the regular payment, next due date, payoff date (and where it came from) and whether it's overdue. The loans and cards total is what net worth counts; buy now, pay later plans are on top.",
    input_schema: noInput,
  },
  {
    name: "payoff_plan",
    description:
      "A plan to pay off every debt except the mortgage, with the same math as the payoff planner: the minimums added up, debt-free month and total interest paying highest rate first and smallest balance first, what paying only the minimums would cost, what paying more each month does, debts left out and why, and the plan the person started (with whether it was on track at the last monthly check). In demo advice mode it also has Jane's pick of order and why. Give extra_dollars to see a different extra amount a month.",
    input_schema: {
      type: "object",
      properties: {
        extra_dollars: {
          type: "number",
          description: "Extra a month on top of the minimums, in dollars.",
        },
      },
      additionalProperties: false,
    },
  },
  REFINANCE_TOOL,
  {
    name: "debt_autopilot",
    description:
      "What Jane does about the person's debts by herself at their debt autopilot level (step by step), loan and card payments due in the next month (soonest first, overdue first), payments due just before payday with the drafted request to move the date, rate changes the bank reported, and whether Jane started the payoff plan herself. Jane never applies for credit, moves money or signs without a tap.",
    input_schema: noInput,
  },
  {
    name: "credit_score",
    description:
      "The person's credit score from Jane's monthly soft pull (a stand-in score for demo-bank people, never a real one; nothing for real accounts until a credit partner is connected): the score and range, the move since last month, each factor helping or hurting (payment history, card use, age of accounts, new credit, kinds of credit), card use against limits with what to pay to bring it under 30% and 10%, and what Jane is doing about it.",
    input_schema: noInput,
  },
  {
    name: "mortgage",
    description:
      "The person's mortgage, watched: balance, rate, payment; whether it has PMI and the loan as a share of the home's value (from the value they gave), with whether PMI can come off and the steps (rules from the CFPB); escrow balance and any escrow change in the payment; what extra principal each month would save; the best refinance offer's monthly saving, closing costs and break-even months.",
    input_schema: noInput,
  },
  {
    name: "student_loans",
    description:
      "The person's federal student loan compared under each repayment plan (their plan now, Standard, Income-Based Repayment, the Repayment Assistance Plan): the payment now, everything paid and anything forgiven at today's income, from the plans' rules with sources; forgiveness tracking (qualifying payments counted, toward PSLF or IBR forgiveness); the income used and where it came from; how many of studentaid.gov's steps are done, with each step's official page. In demo advice mode, Jane's pick and why.",
    input_schema: noInput,
  },
  {
    name: "balance_transfers",
    description:
      "0% balance transfer offers for the person's cards (sample offers from a stand-in catalog; only demo-bank people have any): for each card, each offer's months at 0%, transfer fee, the monthly payment that clears the balance and fee before the 0% ends, the interest keeping it on the card at that payment would cost, and the saving with the fee counted; Jane's pick and why. Also the transfers the person told Jane they made, with when the 0% ends.",
    input_schema: noInput,
  },
  {
    name: "loan_applications",
    description:
      "The person's loan applications for refinance offers (spec step 112): the lender, the loan it pays off, the terms (rate, months, monthly payment, fee, total, saving) and where each stands: draft (prepared, not sent), approved (waiting for their yes), declined, accepted, funded (old loan being paid off), paid_off (old loan at zero) or withdrawn. Jane never submits or accepts one herself.",
    input_schema: noInput,
  },
];

// The extra a month Claude asked about, in cents; undefined when it gave none or nonsense.
export function extraFromInput(input: unknown): number | undefined {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const dollars = value.extra_dollars;
  if (typeof dollars !== "number" || !Number.isFinite(dollars)) return undefined;
  const cents = Math.round(dollars * 100);
  return cents >= 0 && cents <= MAX_DEBT_EXTRA_CENTS ? cents : undefined;
}

export function payoffToolOutput(payoff: Payoff, asOf: string, money: (cents: number) => string) {
  const { summary, stored } = payoff;
  const outcome = (plan: PayoffPlan) =>
    plan.ok
      ? {
          debtFree: monthAfter(asOf, plan.months),
          months: plan.months,
          interest: money(plan.totalInterestCents),
        }
      : { neverFinishes: plan.reason };
  return {
    debts: summary.cards.map((c) => ({
      name: c.name,
      balance: money(c.balanceCents),
      rate: formatRate(c.aprBps),
      monthlyPayment: money(c.minimumCents),
    })),
    leftOut: summary.leftOut,
    minimumsAMonth: money(summary.minimumsCents),
    extraAMonth: money(summary.extraCents),
    highestRateFirst: outcome(summary.avalanche),
    smallestBalanceFirst: outcome(summary.snowball),
    minimumsOnlyEachOnItsOwn: outcome(summary.baseline),
    payingMore: summary.scenarios.map((s) => ({
      extraAMonth: money(s.extraCents),
      debtFree: monthAfter(asOf, s.months),
      interest: money(s.interestCents),
      interestSavedVsMinimums: s.interestSavedCents === null ? null : money(s.interestSavedCents),
    })),
    janesPick: summary.pick,
    // What the two orders differ by in interest, so it can be quoted.
    interestDifference:
      summary.avalanche.ok && summary.snowball.ok
        ? money(
            Math.abs(summary.snowball.totalInterestCents - summary.avalanche.totalInterestCents),
          )
        : null,
    adviceMode: payoff.advice,
    startedPlan: stored && {
      order: stored.strategy === "avalanche" ? "highest rate first" : "smallest balance first",
      extraAMonth: money(stored.extraCents),
      debtFree: stored.debtFreeMonth,
      lastCheck: stored.status && {
        on: stored.checkedOn,
        status: stored.status,
        expected: stored.expectedCents === null ? null : money(stored.expectedCents),
        owed: stored.actualCents === null ? null : money(stored.actualCents),
      },
    },
  };
}

export function debtsToolOutput(book: DebtBook, money: (cents: number) => string) {
  return {
    loansAndCardsOwed: money(book.accountsOwedCents),
    buyNowPayLaterOwed: money(book.bnplOwedCents),
    buyNowPayLaterWithoutABalance: book.bnplUnknown,
    totalOwed: money(book.totalOwedCents),
    monthlyPayments: money(book.monthlyCents),
    debts: book.debts.map((d) => ({
      name: d.name,
      kind: d.kindLabel,
      balance: d.balanceCents === null ? null : money(d.balanceCents),
      rate: d.aprBps === null ? null : formatRate(d.aprBps),
      rateType: d.rateType,
      rateFrom: sourceLabel(d.aprFrom, d.typedOn),
      payment: d.paymentCents === null ? null : money(d.paymentCents),
      paymentEvery: d.paymentEvery === "month" ? "month" : "two weeks",
      nextDue: d.nextDue,
      payoffDate: d.payoffDate,
      payoffFrom: d.payoffDate ? sourceLabel(d.payoffFrom, d.typedOn) : null,
      overdue: d.overdue,
      pastDue: d.pastDueCents ? money(d.pastDueCents) : null,
      inNetWorth: d.inNetWorth,
    })),
    missingRates: book.missingRate.map((d) => d.name),
  };
}

// Pages Claude may link to about debts (./claude-tools.ts CHAT_PAGES).
export const DEBT_CHAT_PAGES: Readonly<Record<string, { label: string; href: string }>> = {
  loans: { label: "See every debt", href: "/loans" },
  debt: { label: "Open the payoff planner", href: "/debt" },
  refinance: { label: "See the offers", href: "/loans/refinance" },
  student: { label: "See student loan plans", href: "/loans/student" },
  mortgage: { label: "See your mortgage", href: "/loans/mortgage" },
  credit: { label: "See your credit score", href: "/loans/credit" },
};

// What the chat shows while Claude looks each one up (./claude.ts).
export const DEBT_TOOL_STATUS: Readonly<Record<string, string>> = {
  debts: "Looking at your debts…",
  payoff_plan: "Working out your payoff plan…",
  refinance_offers: "Checking loan offers…",
  loan_applications: "Checking your loan applications…",
  balance_transfers: "Checking 0% transfer offers…",
  student_loans: "Comparing student loan plans…",
  mortgage: "Looking at your mortgage…",
  credit_score: "Checking your credit score…",
  debt_autopilot: "Checking what's due on your debts…",
};

export function refinanceToolOutput(refi: Refinance, money: (cents: number) => string) {
  if (!refi.available) {
    return { note: "No lending partner for this person's accounts yet, so there are no offers." };
  }
  const offer = (s: ScoredOffer) => ({
    lender: s.offer.lender,
    rate: formatRate(s.offer.aprBps),
    rateType: s.offer.rateType,
    fee: money(s.offer.feeCents),
    feeIs: s.offer.feeLabel,
    monthlyPayment: money(s.monthlyCents),
    totalOverSameMonths: money(s.totalCents),
    saving: money(s.savingCents),
    breakEvenMonths: s.breakEvenMonths,
    sample: s.offer.demo,
  });
  return {
    checkedOn: refi.checkedOn,
    debts: refi.comparisons.map((c) => ({
      debt: c.debtName,
      balance: money(c.balanceCents),
      rate: formatRate(c.currentAprBps),
      monthsLeft: c.termMonths,
      keepingItCosts: money(c.currentTotalCents),
      keepingMonthlyPayment: money(c.currentMonthlyCents),
      janesPick: c.pick && offer(c.pick),
      why: c.why,
      offers: c.offers.map(offer),
    })),
  };
}

export function applicationsToolOutput(
  apps: readonly LoanApplicationView[],
  money: (cents: number) => string,
) {
  return {
    applications: apps.map((a) => ({
      lender: a.lender,
      payingOff: a.oldName,
      status: a.status,
      whereItStands: statusLine(a),
      rate: formatRate(a.aprBps),
      rateType: a.rateType,
      months: a.termMonths,
      amount: money(a.amountCents),
      monthlyPayment: money(a.monthlyCents),
      fee: money(a.feeCents),
      inAll: money(a.totalCents),
      saving: money(a.savingCents),
      sample: a.partner === "demo",
    })),
  };
}

export function transfersToolOutput(data: Transfers, money: (cents: number) => string) {
  if (!data.available) {
    return { note: "No lending partner for this person's accounts yet, so there are no offers." };
  }
  return {
    cards: data.comparisons.map((c) => ({
      card: c.debtName,
      balance: money(c.balanceCents),
      rate: formatRate(c.aprBps),
      janesPick: c.pick?.offer.cardName ?? null,
      why: c.why,
      offers: c.offers.map((s) => ({
        card: s.offer.cardName,
        issuer: s.offer.issuer,
        monthsAtZero: s.offer.promoMonths,
        fee: money(s.offer.feeCents),
        afterwards: formatRate(s.offer.goToAprBps),
        payAMonthToClearIt: money(s.monthlyNeededCents),
        zeroEnds: s.promoEndsOn,
        keepingItInterest: s.keepInterestCents === null ? null : money(s.keepInterestCents),
        savingWithFeeCounted: s.savingCents === null ? null : money(s.savingCents),
        sample: s.offer.demo,
      })),
    })),
    transfersMade: data.transfers.map((t) => ({
      card: t.cardName,
      from: t.fromName,
      moved: money(t.amountCents),
      fee: money(t.feeCents),
      zeroEnds: t.promoEndsOn,
      payAMonth: money(t.monthlyNeededCents),
      status: t.status,
    })),
  };
}

export function studentToolOutput(data: StudentLoans, money: (cents: number) => string) {
  if (!data.loan || !data.comparison)
    return { note: "No federal student loan with a balance and rate." };
  return {
    loan: data.loan.name,
    balance: money(data.loan.balanceCents!),
    rate: formatRate(data.loan.aprBps!),
    income: money(data.agiCents),
    incomeFrom:
      data.agiFrom === "you" ? "the person gave it" : "estimated from paychecks (take-home)",
    plans: data.comparison.results.map((r) => ({
      plan: PLAN_NAMES[r.plan],
      monthlyNow: money(r.monthlyNowCents),
      totalPaid: money(r.totalPaidCents),
      forgiven: money(r.forgivenCents),
      throughPslf: r.viaPslf,
      months: r.months,
    })),
    janesPick: data.comparison.pick && {
      plan: PLAN_NAMES[data.comparison.pick.plan],
      why: data.comparison.pick.why,
    },
    forgiveness: {
      toward: data.countingToward.name,
      counted: data.paymentsCounted,
      needed: data.countingToward.needed,
      seenByJane: data.paymentsSeen,
    },
    steps: STUDENT_STEPS.map((s, i) => ({
      step: s.title,
      officialPage: s.url,
      done: i < data.profile.stepsDone,
    })),
    sources: STUDENT_SOURCES,
  };
}

export function mortgageToolOutput(m: Mortgage | null, money: (cents: number) => string) {
  if (!m) return { note: "No mortgage on the linked accounts." };
  return {
    loan: m.loan.name,
    balance: money(m.loan.balanceCents!),
    rate: m.loan.aprBps === null ? null : formatRate(m.loan.aprBps),
    payment: m.loan.paymentCents === null ? null : money(m.loan.paymentCents),
    hasPmi: m.hasPmi,
    homeValue: m.home && {
      value: money(m.home.valueCents),
      valuedOn: m.home.valuedOn,
      fromThePerson: true,
    },
    pmi:
      m.pmi.kind === "can_ask" || m.pmi.kind === "not_yet"
        ? {
            status: m.pmi.kind,
            loanToValue: Math.round(m.pmi.ltv * 1000) / 10,
            steps: PMI_STEPS,
            source: PMI_SOURCE,
          }
        : { status: m.pmi.kind },
    escrowBalance: m.escrowBalanceCents === null ? null : money(m.escrowBalanceCents),
    escrowChange: m.escrow && {
      from: money(m.escrow.fromCents),
      to: money(m.escrow.toCents),
      on: m.escrow.on,
    },
    prepaymentPenalty: m.hasPrepaymentPenalty,
    extraPrincipal: m.extra?.scenarios.map((s) => ({
      extraAMonth: money(s.extraCents),
      monthsSooner: s.monthsSaved,
      interestSaved: money(s.interestSavedCents),
    })),
    refinance: m.refi && {
      lender: m.refi.lender,
      rate: formatRate(m.refi.aprBps),
      monthlySaving: money(m.refi.monthlySavingCents),
      closingCosts: money(m.refi.closingCostsCents),
      breakEvenMonths: m.refi.breakEvenMonths,
    },
  };
}

export function creditToolOutput(credit: Credit, money: (cents: number) => string) {
  if (!credit.available)
    return { note: "No credit partner for this person's accounts, so nothing is pulled." };
  const latest = credit.latest;
  if (!latest) return { note: "Not checked yet." };
  return {
    score: latest.score,
    range: latest.range,
    model: latest.model,
    standIn: latest.demo,
    pulledOn: latest.pulledOn,
    lastMonth: credit.previousScore,
    factors: latest.factors,
    cardUse: latest.utilisation && {
      share: Math.round(latest.utilisation.share * 100),
      balances: money(latest.utilisation.balanceCents),
      limits: money(latest.utilisation.limitCents),
      payToGetUnder30: money(latest.utilisation.toUnderHighCents),
      payToGetUnder10: money(latest.utilisation.toUnderGoodCents),
    },
    janeIsDoing: latest.doing,
  };
}

export function debtAutopilotToolOutput(data: DebtAutopilot, money: (cents: number) => string) {
  return {
    debtAutopilotLevel: data.level,
    janeDoesByHerself: data.does.map((d) => d.does),
    alwaysNeedsATap: "applying for credit, moving money, signing",
    upcomingPayments: data.upcoming.map((d) => ({
      debt: d.name,
      due: d.due,
      payment: d.paymentCents === null ? null : money(d.paymentCents),
      overdue: d.overdue,
    })),
    dueDateMoves: data.dueMoves.map((m) => ({
      debt: m.debtName,
      dueDay: m.dueDay,
      payday: m.payday,
      suggestedDay: m.suggestedDay,
      request: m.request,
    })),
    rateChanges: data.rateChanges.map((c) => ({
      debt: c.name,
      from: formatRate(c.fromBps),
      to: formatRate(c.toBps),
      on: c.on,
    })),
    payoffPlanStartedByJaneOn: data.planStartedOn,
  };
}
