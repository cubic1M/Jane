import {
  COUNSELOR_REFERRALS,
  COUNSEL_POINTER,
  DEBT_FACTS,
  DMP_NOTE,
  HARDSHIP_PROGRAMS,
} from "@/config/debt-trouble";
import { sourceLabel, type DebtBook } from "@/insights/debts";
import type { Payoff } from "@/lib/debt-plan";
import { statusLine, type LoanApplicationView } from "@/lib/loan-application-status";
import type { Transfers } from "@/lib/balance-transfers";
import type { Refinance } from "@/lib/refinance";
import type { StudentLoans } from "@/lib/student-loans";
import type { Mortgage } from "@/lib/mortgage";
import type { Credit } from "@/lib/credit";
import type { CreditCards } from "@/lib/credit-cards";
import type { CreditBuilding } from "@/lib/credit-building";
import type { Bnpl } from "@/lib/bnpl";
import { warnNewPlan } from "@/planning/bnpl";
import type { TightMoney } from "@/lib/tight-money";
import type { Car } from "@/lib/car";
import type { HomeBuying } from "@/lib/home-buying";
import type { MedicalBills } from "@/lib/medical-bills";
import type { ReportFixes } from "@/lib/credit-report-fixes";
import type { CardInterest } from "@/lib/card-interest";
import type { LongGame } from "@/lib/student-long-game";
import type { FamilyLoans } from "@/lib/family-loans";
import type { CreditGoals } from "@/lib/credit-goals";
import type { CostlyBorrowing } from "@/lib/costly-borrowing";
import type { MortgageMoneyView } from "@/lib/mortgage-money";
import type { CarLoan } from "@/lib/car-loan";
import type { Renting } from "@/lib/renting";
import type { BorrowingPower } from "@/lib/borrowing-power";
import type { CreditMonthly } from "@/lib/credit-monthly";
import type { FamilyCredit } from "@/lib/family-credit";
import type { DebtReview } from "@/lib/debt-review";
import type { DebtTrouble } from "@/lib/debt-trouble";
import type { HomeEquity, ProjectComparison } from "@/lib/home-equity";
import { REWARD_CATEGORY_LABELS } from "@/config/credit-cards";
import type { DebtAutopilot } from "@/lib/debt-autopilot";
import { PMI_SOURCE } from "@/config/debt";
import { PMI_ASK_ORIGINAL } from "./mortgage-replies";
import type { FitView } from "@/lib/fit";
import { fitCard } from "@/lib/fit-card";
import type { OptionCard } from "@/lib/option-card";
import { DEMO_ADVICE_LABEL } from "@/config/advice";
import {
  homeMeasureOf,
  homeVsBorrow,
  mortgageOf,
  type HomeMeasure,
} from "@/planning/home-vs-borrow";
import { FIT_LABEL_TEXT, type FitTerms } from "@/planning/fit";
import { STUDENT_SOURCES, STUDENT_STEPS } from "@/config/student-loans";
import { PLAN_NAMES } from "@/planning/student-loans";
import type { PayoffPlan } from "@/planning/debt";
import type { ScoredOffer } from "@/planning/refinance";
import { monthAfter } from "@/planning/payoff";
import { formatRate } from "@/lib/percent";
import { initialsOf } from "@/lib/person-payees";

// What Claude's debt tools in Jane's chat (./debt-tools.ts) hand back: each tool's result,
// built from the same debt book as the loans page (src/lib/debts.ts) and run by
// ./debt-tools-run.ts. Every dollar figure goes through `money`, so the guardrails know it came
// from a tool (./claude-tools.ts).

export function payoffToolOutput(payoff: Payoff, asOf: string, money: (cents: number) => string) {
  const { summary, stored } = payoff;
  // Nothing to plan with: no months, no interest and no "debt-free next month".
  if (summary.cards.length === 0) {
    return {
      debts: [],
      leftOut: summary.leftOut,
      note: "No debt with a balance is known, so there's no plan to work out.",
    };
  }
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
      interestSaved: s.interestSavedCents === null ? null : money(s.interestSavedCents),
    })),
    // What payingMore's interestSaved is against: each debt's own minimum, or this plan with
    // nothing more a month (when the minimums alone never pay everything off).
    interestSavedAgainst:
      summary.savedAgainst === "minimums" ? "each debt's minimum alone" : "this plan, nothing more",
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
  const unread = book.debts.filter((d) => d.balanceCents === null).map((d) => d.name);
  // Nothing added up because no balance is known isn't $0 owed: never one for Claude to repeat.
  const totalOf = (cents: number) => (cents === 0 && unread.length > 0 ? null : money(cents));
  return {
    loansAndCardsOwed: totalOf(book.accountsOwedCents),
    buyNowPayLaterOwed: money(book.bnplOwedCents),
    buyNowPayLaterWithoutABalance: book.bnplUnknown,
    totalOwed: totalOf(book.totalOwedCents),
    monthlyPayments: totalOf(book.monthlyCents),
    ...(unread.length > 0 ? { balancesNotKnown: unread } : {}),
    debts: book.debts.map((d) => ({
      name: d.name,
      kind: d.kindLabel,
      balance: d.balanceCents === null ? null : money(d.balanceCents),
      balanceFrom:
        d.balanceCents === null && d.fromUpload
          ? "not in their uploaded file, and none typed: they can add it on the import page"
          : sourceLabel(d.balanceFrom, d.typedOn),
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
    totalWithFees: money(s.totalCents),
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
      // Offers are priced over the debt's own remaining months; keeping it is paying what the
      // person pays now until it's gone (the same comparison as the loan_fit tool).
      offersPricedOverMonths: c.termMonths,
      keepingItTakesMonths: c.keepMonths,
      keepingItCosts: money(c.currentTotalCents),
      keepingMonthlyPayment: money(c.currentMonthlyCents),
      // A mortgage's payments here are principal and interest; the escrow stays as it is.
      ...(c.escrowCents !== undefined
        ? { paymentsArePrincipalAndInterest: true, escrowThatStays: money(c.escrowCents) }
        : {}),
      janesPick: c.pick && offer(c.pick),
      ...(c.cashPayoffCents
        ? {
            payOffFromCashInstead: {
              saves: money(c.cashPayoffCents),
              keepsTheEmergencyCushion: true,
            },
          }
        : {}),
      ...(c.turnedDown ? { lenderWouldLikelyDecline: c.turnedDown } : {}),
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
      data.agiFrom === "you"
        ? "the person gave it"
        : data.agiFrom === "paychecks"
          ? "estimated from paychecks (take-home)"
          : "unknown: no paychecks seen, so the plans use $0; ask for their tax return's income",
    plans: data.comparison.results.map((r) => ({
      plan: PLAN_NAMES[r.plan],
      monthlyNow: money(r.monthlyNowCents),
      totalPaid: money(r.totalPaidCents),
      forgiven: money(r.forgivenCents),
      ...(r.leftCents > 0 && { stillOwedWhenPaymentsEnd: money(r.leftCents), paidOff: false }),
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
    // One PMI rule (as the home_equity tool and both pages): the original value, not today's.
    pmi:
      m.hasPmi !== true
        ? { status: m.hasPmi === false ? "none" : "not_reported" }
        : !m.pmi
          ? { status: "needs_the_original_value", ask: PMI_ASK_ORIGINAL, source: PMI_SOURCE }
          : {
              status: m.pmi.endsNow ? "ends_by_itself" : m.pmi.canAskNow ? "can_ask" : "not_yet",
              loanAsShareOfOriginalValue: Math.round(m.pmi.ltv * 1000) / 10,
              balanceToAsk: money(m.pmi.askBalanceCents),
              askAround: m.pmi.askOn,
              endsByItselfAround: m.pmi.autoOn,
              source: PMI_SOURCE,
            },
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

export function creditCardsToolOutput(cards: CreditCards, money: (cents: number) => string) {
  if (!cards.available) {
    return { note: "No card partner for this person's accounts, so no rewards or card offers." };
  }
  const label = (c: keyof typeof REWARD_CATEGORY_LABELS) => REWARD_CATEGORY_LABELS[c];
  const nameOf = (id: string) => cards.cards.find((c) => c.product?.id === id)?.name ?? id;
  return {
    demoAdvice: true,
    daysOfSpending: cards.spend.days,
    firstLook: cards.firstLook,
    yearlySpending: Object.fromEntries(
      Object.entries(cards.spend.byCategory).map(([k, v]) => [label(k as never), money(v)]),
    ),
    cards: cards.cards.map((c) => ({
      name: c.name,
      notLinkedYet: c.fromApplication,
      rewards: c.product?.rewardsLabel ?? "not known",
      annualFee: c.product ? money(c.product.annualFeeCents) : null,
      earnsAfterFeeOnAllSpending: c.earnsCents === null ? null : money(c.earnsCents),
      feeCheck: c.fee && {
        earns: money(c.fee.earnsCents),
        afterFee: money(c.fee.netCents),
        paysForItself: c.fee.paysForItself,
        bestNoFeeCard: c.fee.noFee && {
          name: c.fee.noFee.card.name,
          wouldEarn: money(c.fee.noFee.earnsCents),
        },
      },
    })),
    useForEachKind: cards.wallet.picks
      .filter((p) => cards.spend.byCategory[p.category] > 0)
      .map((p) => ({
        kind: label(p.category),
        card: nameOf(p.cardId),
        earns: money(p.earnsCents),
      })),
    yearlyRewards: money(cards.wallet.earnsCents),
    annualFees: money(cards.wallet.feesCents),
    afterFees: money(cards.wallet.netCents),
    betterCards: cards.better.map((b) => ({
      name: b.card.name,
      issuer: b.card.issuer,
      annualFee: money(b.card.annualFeeCents),
      addsAYearAfterFee: money(b.gainCents),
      usedFor: b.usedFor.map(label),
      signUpBonus: b.card.intro && {
        bonus: money(b.card.intro.bonusCents),
        afterSpending: money(b.card.intro.spendCents),
        months: b.card.intro.months,
        withinUsualSpending: b.introReachable,
      },
    })),
    applications: cards.applications.map((a) => ({
      card: a.cardName,
      issuer: a.issuer,
      status: a.status,
      on: a.createdOn,
    })),
  };
}

export function creditBuildingToolOutput(data: CreditBuilding, money: (cents: number) => string) {
  if (!data.available) return { note: "No credit partner for this person's accounts." };
  const s = data.statement;
  return {
    demoAdvice: true,
    debtAutopilotLevel: data.level,
    score: data.score,
    nextStatement: s && {
      card: s.cardName,
      closesOn: s.closesOn,
      payBy: s.payOn,
      payToGetUnder30: money(s.toUnderHighCents),
      payToGetUnder10: money(s.toUnderGoodCents),
      suggested: s.suggested && {
        amount: money(s.suggested.amountCents),
        under: s.suggested.target === "good" ? "10%" : "30%",
      },
      alreadyScheduled: s.scheduled && {
        amount: money(s.scheduled.amountCents),
        on: s.scheduled.runOn,
        by: s.scheduled.by,
      },
    },
    onTimeStreak: data.streak && {
      months: data.streak.months,
      since: data.streak.since,
      noLatePaymentsSeen: data.streak.clean,
    },
    thinFile: data.thin,
    creditBuilders: data.builders.map((b) => ({
      name: b.name,
      issuer: b.issuer,
      summary: b.summary,
      cost: money(b.costCents),
    })),
    simulatorEstimates: data.estimates.map((e) => ({
      change: e.label,
      estimatedScore: e.score,
      points: e.change,
    })),
    note: "Simulator figures are estimates from the stand-in score, not promises.",
  };
}

export function bnplToolOutput(
  data: Bnpl,
  totalCents: number | null,
  money: (cents: number) => string,
) {
  const strain = totalCents ? warnNewPlan(data, totalCents) : null;
  return {
    plans: data.plans.map((p) => ({
      name: p.name,
      payment: money(p.paymentCents),
      every: p.every === "two_weeks" ? "two weeks" : "month",
      nextDue: p.nextDue,
      balance: p.balanceCents === null ? null : money(p.balanceCents),
      freeToPayOffNow: p.freePayoff && p.canCoverPayoff && !p.payoffScheduled,
    })),
    installmentsNextMonth: data.installments.map((i) => ({
      on: i.date,
      plan: i.name,
      amount: money(i.cents),
    })),
    notInForecastYet: data.missing.map((i) => ({
      on: i.date,
      plan: i.name,
      amount: money(i.cents),
    })),
    newPlanCheck: strain && {
      total: money(totalCents!),
      strainsTheMonth: strain.strained,
      lowestCheckingWithPlan: money(strain.lowestWith.balanceCents),
      on: strain.lowestWith.date,
      lowestCheckingWithout: money(strain.lowestWithout.balanceCents),
      underTheCushionBy: money(strain.shortCents),
    },
    alwaysNeedsATap: "paying a plan off",
  };
}

export function tightMoneyToolOutput(data: TightMoney, money: (cents: number) => string) {
  if (!data.available) return { note: "No lender partner for this person's accounts yet." };
  return {
    demoAdvice: true,
    shortfall: data.shortfall && {
      on: data.shortfall.date,
      forecastBalance: money(data.shortfall.balanceCents),
      underTheCushionBy: money(data.shortfall.shortCents),
    },
    payInThisOrder: data.billsFirst.map((b) => ({
      payee: b.payee,
      on: b.date,
      amount: money(b.amountCents),
      essential: b.essential,
    })),
    requests: data.items.map((i) => ({
      id: i.id,
      what: i.label,
      text: i.body,
      couldFree: i.freesCents === null ? null : money(i.freesCents),
      sent: i.sent && { on: i.sent.sentOn, status: i.sent.status, answer: i.sent.outcome },
    })),
    alwaysNeedsATap: "sending any request",
  };
}

export function carToolOutput(car: Car, money: (cents: number) => string) {
  if (!car.available) return { note: "No lending partner for this person's accounts yet." };
  if (!car.costs) return { note: "Not enough income history to say what car fits." };
  const c = car.costs;
  return {
    demoAdvice: true,
    // Lead with the comfortable target; the most is only the ceiling the maths allows.
    comfortablePrice: money(car.comfortPriceCents!),
    comfortableAllInPerMonth: money(car.comfortAllowanceCents!),
    maxPriceCeiling: money(car.maxPriceCents!),
    allInBudgetPerMonth: money(car.allowanceCents!),
    atPrice: money(c.priceCents),
    withinBudget: car.withinBudget,
    monthly: {
      loanPayment: money(c.paymentCents),
      insurance: money(c.insuranceCents),
      fuel: money(c.fuelCents),
      upkeep: money(c.maintenanceCents),
      registration: money(c.registrationCents),
      allIn: money(c.allInCents),
    },
    preapprovals: car.offers.map((o) => ({
      lender: o.offer.lender,
      rate: `${formatRate(o.offer.aprBps)}`,
      monthly: money(o.monthlyCents),
      totalCost: money(o.totalCents),
      fees: o.offer.feeLabel,
    })),
    // Lenders cap car loans: the most one would quote, when it's under what was checked.
    mostALenderWouldLend: car.lenderLimitCents === null ? undefined : money(car.lenderLimitCents),
    dealer: car.dealer && {
      verdict: car.dealer.verdict,
      monthly: money(car.dealer.monthlyCents),
      totalCost: money(car.dealer.totalCents),
      costsMoreThanBestPreapproval: money(car.dealer.extraCents),
    },
    assumptions: car.assumptions,
  };
}

export function homeToolOutput(
  home: HomeBuying,
  money: (cents: number) => string,
  mortgageCents: number | null = null,
) {
  if (!home.costs || !home.affordability || !home.saving) {
    return { note: "Not enough income history to say what home fits." };
  }
  const c = home.costs;
  return {
    demoAdvice: home.advice,
    rate: `${formatRate(home.aprBps ?? 0)}${home.rateIsOffer ? " (a lender's offer)" : " (a typical rate, not an offer)"}`,
    maxPrice: money(home.affordability.maxPriceCents),
    allowedHousingPerMonth: money(home.affordability.allowedHousingCents),
    atPrice: money(c.priceCents),
    monthly: {
      loan: money(c.principalAndInterestCents),
      propertyTax: money(c.propertyTaxCents),
      insurance: money(c.insuranceCents),
      pmi: money(c.pmiCents),
      total: money(c.housingCents),
    },
    cashNeeded: {
      downPayment: money(c.downCents),
      closingCosts: money(c.closingCents),
      total: money(c.cashNeededCents),
    },
    saving: {
      saved: money(home.savedCents),
      keepsPerMonth: money(home.monthlySavingCents),
      stillNeeded: money(home.saving.stillNeededCents),
      monthsAtCurrentPace: home.saving.monthsAtCurrentPace,
      targetDate: home.targetDate,
      neededPerMonthForTargetDate: money(home.saving.monthlyNeededCents),
      onTrack: home.saving.onTrack,
      goalStarted: home.hasGoal,
    },
    mortgageOffers: home.offers.map((o) => ({
      lender: o.offer.lender,
      rate: `${formatRate(o.offer.aprBps)}`,
      monthlyForLoan: money(o.monthlyCents),
      totalCostWithClosing: money(o.totalCents),
      closing: o.offer.feeLabel,
    })),
    assumptions: home.assumptions,
    // "What could I borrow?" measures it another way: say both, with this sentence.
    ...(homeVsBorrow(homeMeasureOf(home), mortgageCents)
      ? { whyWhatYouCouldBorrowDiffers: homeVsBorrow(homeMeasureOf(home), mortgageCents) }
      : {}),
  };
}

export function medicalToolOutput(data: MedicalBills, money: (cents: number) => string) {
  if (!data.available) return { note: "No provider partner for this person's accounts yet." };
  return {
    demoAdvice: true,
    hasActiveHealthPlan: data.hasInsurance,
    bills: data.bills.map((b) => ({
      provider: b.provider,
      amount: money(b.amountCents),
      billedOn: b.billedOn,
      source: b.source,
      requests: b.items.map((i) => ({
        id: i.id,
        what: i.label,
        letter: i.body,
        sent: i.sent && {
          on: i.sent.sentOn,
          status: i.sent.status,
          answer: i.sent.outcome,
          tookOff: money(i.sent.savedCents),
        },
      })),
    })),
    alwaysNeedsATap: "sending any request",
  };
}

export function reportFixesToolOutput(data: ReportFixes, money: (cents: number) => string) {
  if (!data.available) return { note: "No credit partner for this person's accounts yet." };
  return {
    demoAdvice: true,
    standIn: true,
    items: data.fixes.map((f) => ({
      creditor: f.item.creditor,
      kind: f.item.kind,
      amount: f.item.amountCents === null ? null : money(f.item.amountCents),
      detail: f.item.detail,
      fixedByADispute: f.fixed,
      letters: f.letters.map((l) => ({
        id: l.id,
        what: l.label,
        lastDayToAsk: l.windowEndsOn,
        letter: l.body,
        sent: l.sent && {
          on: l.sent.sentOn,
          answerDueBy: l.sent.deadlineOn,
          status: l.sent.status,
          removedOrCorrected: l.sent.removed,
          answer: l.sent.outcome,
        },
      })),
    })),
    alwaysNeedsATap: "sending any letter",
  };
}

export function cardInterestToolOutput(data: CardInterest, money: (cents: number) => string) {
  if (!data.available) return { note: "No lending partner for this person's accounts yet." };
  return {
    demoAdvice: true,
    interestPerYear: money(data.interestYearCents),
    rateCutsWonPerYear: money(data.grantedSavingCents),
    cards: data.cards.map((c) => ({
      card: c.name,
      balance: money(c.balanceCents),
      rate: `${formatRate(c.aprBps)}`,
      interestPerYear: money(c.interestYearCents),
      payNowInsteadOfOnDueDate: c.payEarly && {
        amount: money(c.payEarly.amountCents),
        saves: money(c.payEarly.savedCents),
      },
      statementCloses: c.statementClosesOn,
      lowerRateRequest: c.rate && {
        id: c.rate.id,
        wouldSavePerYear: money(c.rate.savingYearlyCents),
        letter: c.rate.body,
        callScript: c.rate.script,
        sent: c.rate.sent && {
          on: c.rate.sent.sentOn,
          status: c.rate.sent.status,
          answer: c.rate.sent.outcome,
        },
      },
    })),
    promotions: data.promos.map((p) => ({
      card: p.cardName,
      balance: money(p.balanceCents),
      ends: p.endsOn,
      daysLeft: p.plan.daysLeft,
      deferredInterest: p.deferred,
      monthlyNeededToClear: money(p.plan.monthlyNeededCents),
      payingNow: money(p.plan.monthlyPaidCents),
      onPace: p.plan.onPace,
      costIfMissed: money(p.plan.costIfMissedCents),
      deadlineOnDeadlinesList: p.deadlineRaised,
    })),
    alwaysNeedsATap: "sending any request",
  };
}

export function studentLongGameToolOutput(g: LongGame, money: (cents: number) => string) {
  if (!g.available) return { note: "No student loan with a balance and a rate for this person." };
  return {
    demoAdvice: g.advice,
    loanType: g.loanType,
    inPublicService: g.publicService,
    pslf: g.pslf && {
      counted: g.pslf.counted,
      of: 120,
      remaining: g.pslf.remaining,
      forgivenAround: g.pslf.forgivenOn,
      months: g.pslf.grid,
    },
    nextCertifyEmployerBy: g.certifyOn,
    nextRecertifyIncomeBy: g.recertifyOn,
    forgiveness: g.forgiveness && {
      plan: g.forgiveness.plan,
      around: g.forgiveness.on,
      amount: money(g.forgiveness.forgivenCents),
      viaPslf: g.forgiveness.viaPslf,
    },
    taxOnForgiven: g.tax && {
      taxable: g.tax.taxable,
      estimate: money(g.tax.estimateCents),
      note: g.tax.note,
    },
    refinancing: g.refi && {
      verdict: g.refi.verdict,
      whatYouWouldLose: g.refi.lost,
      text: g.refi.text,
    },
    assumptions: g.assumptions,
  };
}

export function familyLoansToolOutput(data: FamilyLoans, money: (cents: number) => string) {
  return {
    janeNeverMessagesTheOtherPerson: true,
    waitingForYourAnswer: data.candidates.map((c) => ({
      id: c.id,
      app: c.parsed.app,
      // Initials, never the name: the person sees who on the family page (src/lib/person-payees.ts).
      with: initialsOf(c.parsed.counterparty),
      amount: money(Math.abs(c.transfer.amountCents)),
      on: c.transfer.date,
      // The other person's own words in the app stay out too.
      hasNote: Boolean(c.parsed.note),
      wouldBe: c.kind,
    })),
    loans: data.loans.map((l) => ({
      kind: l.kind,
      with: initialsOf(l.counterparty),
      lentOrBorrowed: money(l.principalCents),
      stillOwed: money(l.balanceCents),
      openedOn: l.openedOn,
      paidBack: l.repaid.map((r) => ({ on: r.date, amount: money(r.cents) })),
      // The drafted reminder greets them by name: it's on the family page, not sent to Claude.
      reminderOnTheFamilyPage: Boolean(l.reminder),
    })),
    cosigned: data.cosigned.map((c) => ({
      loan: c.debtName,
      for: initialsOf(c.counterparty),
      looksLate: c.missed,
      pastDue: c.pastDueCents === null ? null : money(c.pastDueCents),
      noteOnTheFamilyPage: Boolean(c.text),
    })),
    sharedDebts: data.shared.map((s) => ({
      debt: s.name,
      monthly: s.paymentCents === null ? null : money(s.paymentCents),
      yourHalf: s.yourShareCents === null ? null : money(s.yourShareCents),
    })),
  };
}

export function costlyBorrowingToolOutput(d: CostlyBorrowing, money: (cents: number) => string) {
  if (!d.any) return { note: "No costly short-term borrowing found in the last year." };
  return {
    lastYearTotalCost: money(d.totalYearlyCents),
    costInTheLast30Days: money(d.lastMonthCents),
    cycle: d.cycle,
    kinds: d.kinds.map((k) => ({
      kind: k.kind,
      times: k.count,
      cost: money(k.costCents),
      yearlyRatePercent: k.aprBps === null ? null : Math.round(k.aprBps / 100),
      howWorkedOut: k.basis,
      lastOn: k.lastOn,
    })),
    cheaperWaysOut: d.advice
      ? {
          payAlternativeLoan: {
            amount: money(d.alternatives.pal.amountCents),
            months: d.alternatives.pal.termMonths,
            ratePercent: d.alternatives.pal.aprBps / 100,
            monthlyPayment: money(d.alternatives.pal.paymentCents),
            totalCost: money(d.alternatives.pal.totalCostCents),
            paydayLoanFeeForTheSameAmountEveryTwoWeeks: money(d.alternatives.pal.paydayFeeCents),
          },
          employerAdvance: d.alternatives.employer,
          buffer: {
            target: money(d.alternatives.buffer.targetCents),
            months: d.alternatives.buffer.months,
            monthly: money(d.alternatives.buffer.monthlyCents),
          },
          stopTheCycle: d.steps,
        }
      : "Only for the demo bank.",
  };
}

export function mortgageMoneyToolOutput(v: MortgageMoneyView, money: (cents: number) => string) {
  if (!v.available) return { note: "No mortgage with a balance, a rate and an end date." };
  if (!v.advice) return { note: "Only for the demo bank." };
  if (!v.result) return { note: "Give lump_cents and/or extra_monthly_cents to compare." };
  const r = v.result;
  return {
    mortgage: v.loanName,
    ratePercent: (v.aprBps ?? 0) / 100,
    lump: money(v.lumpCents),
    extraAMonth: money(v.extraMonthlyCents),
    doingNothing: {
      payment: money(r.baseline.paymentCents),
      paidOff: r.baseline.endsOn,
      totalInterest: money(r.baseline.totalInterestCents),
    },
    options: r.options.map((o) => ({
      way: o.label,
      available: o.available,
      why: o.why,
      fee: money(o.feeCents),
      payment: money(o.paymentCents),
      paidOff: o.endsOn,
      totalInterest: money(o.totalInterestCents),
      interestSavedWithFeesCounted: money(o.interestSavedCents),
      feePaysBackInMonths: o.breakEvenMonths,
      feePaysBackOn: o.breakEvenOn,
    })),
    investingInstead: {
      put: money(r.invest.putCents),
      years: r.invest.years,
      lowGain: money(r.invest.lowGainCents),
      highGain: money(r.invest.highGainCents),
      notGuaranteed: true,
    },
    certainReturnOfPayingDownPercent: r.guaranteedReturnPercent,
    verdict: r.verdict,
  };
}

export function carLoanToolOutput(data: CarLoan, money: (cents: number) => string) {
  if (!data.available || !data.loan) return { note: "No car loan with a balance." };
  const addon = (a: CarLoan["addons"][number]) => ({
    kind: a.label,
    seller: a.name,
    paid: money(a.paidCents),
    termMonths: a.termMonths,
    boughtOn: a.startedOn,
    status: a.status,
    estimatedRefund: money(a.refund.refundCents),
    monthsUnused: a.refund.monthsLeft,
    cancellationFee: money(a.refund.feeCents),
    letter: a.letter,
  });
  return {
    loan: data.loan.name,
    balance: money(data.loan.balanceCents),
    ratePercent: data.loan.aprBps === null ? null : data.loan.aprBps / 100,
    refinance:
      data.advice && data.refi
        ? {
            lender: data.refi.lender,
            ratePercent: data.refi.aprBps / 100,
            totalCostIfKept: money(data.refi.currentTotalCents),
            totalCostIfRefinanced: money(data.refi.newTotalCents),
            saving: money(data.refi.savingCents),
            fees: money(data.refi.feeCents),
            breakEvenMonths: data.refi.breakEvenMonths,
            standInLenderCatalogNotOffers: true,
            sinceLastCheck: data.change,
          }
        : null,
    confirmedAddOns: data.addons.map(addon),
    maybeAddOns: data.candidates.map((a) => ({
      kind: a.label,
      seller: a.name,
      paid: money(a.paidCents),
      estimatedRefundIfSo: money(a.refund.refundCents),
    })),
  };
}

export function debtReviewToolOutput(data: DebtReview) {
  if (!data.available) return { note: "No debt with a balance to review." };
  return {
    autopilotLevel: data.level,
    lastReview: data.review,
    reviewDueNow: data.due,
    items: data.items.map((i) => ({
      item: i.title,
      status:
        i.status === "done"
          ? "Jane did it"
          : i.status === "tap"
            ? "needs the person's tap"
            : "fine",
      what: i.text,
    })),
  };
}

export function debtTroubleToolOutput(data: DebtTrouble, money: (cents: number) => string) {
  if (!data.available) return { note: "No debt with a balance." };
  return {
    monthlyDebtPayments: money(data.monthlyPaymentsCents),
    monthlyIncome: data.incomeCents === null ? null : money(data.incomeCents),
    shareOfIncomePercent: data.share === null ? null : Math.round(data.share * 100),
    overTheMarkWhereJaneBringsItUp: data.over,
    hardshipProgramsByDebt: data.debts.map((d) => ({
      debt: d.name,
      kind: d.kindLabel,
      balance: money(d.balanceCents ?? 0),
      whatToAsk: HARDSHIP_PROGRAMS[d.kind].ask,
    })),
    debtManagementPlanSketch: data.dmp && {
      cardBalance: money(data.dmp.cardBalanceCents),
      cardPaymentsAMonth: money(data.dmp.cardPaymentCents),
      assumedRatePercent: data.dmp.assumedAprBps / 100,
      assumptionNotAnOffer: true,
      monthsAtTheAssumedRate: data.dmp.monthsAssumed,
      monthsAtTodaysRates: data.dmp.monthsNow,
      interestCutAbout: money(data.dmp.interestCutCents),
    },
    debtManagementPlan: DMP_NOTE,
    nonprofitCounselors: COUNSELOR_REFERRALS.map((c) => ({ name: c.name, url: c.url })),
    reviewedFacts: [...DEBT_FACTS.settlement, ...DEBT_FACTS.bankruptcy, ...DEBT_FACTS.taxes].map(
      (f) => ({ fact: f.text, source: f.source.label }),
    ),
    forLegalQuestions: COUNSEL_POINTER,
  };
}

export function homeEquityToolOutput(
  data: HomeEquity,
  project: ProjectComparison | null,
  money: (cents: number) => string,
) {
  if (!data.available) return { note: "No mortgage with a balance." };
  const e = data.escrow;
  return {
    loan: data.loanName,
    balance: money(data.balanceCents),
    hasPmi: data.hasPmi,
    originalValueGiven:
      data.facts.originalValueCents === null ? null : money(data.facts.originalValueCents),
    pmi: data.pmi && {
      loanAsShareOfOriginalValue: Math.round(data.pmi.ltv * 1000) / 10,
      canAskToCancelNow: data.pmi.canAskNow,
      balanceToAsk: money(data.pmi.askBalanceCents),
      endsByItselfNow: data.pmi.endsNow,
      balanceWhereItEnds: money(data.pmi.autoBalanceCents),
      canAskAround: data.pmi.askOn,
      endsAround: data.pmi.autoOn,
      requestSentOn: data.facts.pmiLetterSentOn,
    },
    pmiRequestLetter: data.pmiLetter,
    escrow:
      e === null
        ? null
        : e.kind === "unknown"
          ? { unknown: e.why }
          : {
              verdict: e.kind,
              billsAYear: money(e.billsCents),
              escrowInPaymentAYear: money(e.collectedYearlyCents),
              mostTheServicerMayHold: money(e.allowedBalanceCents),
              surplus: money(e.surplusCents),
              requestSentOn: data.facts.escrowRequestSentOn,
            },
    escrowRefundRequestLetter: data.escrowLetter,
    projectComparison:
      project === null
        ? data.advice
          ? "Give project_cents to compare."
          : "Only for the demo bank."
        : {
            project: money(project.projectCents),
            years: project.years,
            standInLenderTermsNotOffers: true,
            options: project.options.map((o) => ({
              product: o.label,
              available: o.available,
              why: o.why,
              ratePercent: o.aprBps / 100,
              years: o.years,
              monthly: money(o.monthlyCents),
              upFront: money(o.upfrontCents),
              totalCost: money(o.totalCostCents),
            })),
          },
  };
}

export function creditGoalsToolOutput(data: CreditGoals, money: (cents: number) => string) {
  if (!data.available) return { note: "No credit partner for this person's accounts yet." };
  return {
    estimatesFromAStandInSimulator: true,
    scoreNow: data.scoreNow,
    plans: data.goals.map((g) => ({
      goal: g.title,
      target: g.targetScore,
      by: g.targetDate,
      reachesTarget: g.plan.reaches,
      endsAt: g.plan.endScore,
      bestPossible: g.plan.best,
      totalToPayDown: money(g.plan.totalPayCents),
      months: g.plan.months.map((m) => ({
        month: m.month,
        pay: money(m.payCents),
        estimatedScore: m.projectedScore,
      })),
      thisMonth: g.thisMonth.map((i) => ({ item: i.text, done: i.done })),
    })),
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

export function rentingToolOutput(d: Renting, money: (cents: number) => string) {
  if (!d.renter && d.deposits.length === 0) {
    return { note: "No rent payments found in the last year, and no deposits told to Jane." };
  }
  return {
    monthlyRent: d.monthlyCents === null ? null : money(d.monthlyCents),
    rentIncrease: d.rise
      ? {
          from: money(d.rise.beforeCents),
          to: money(d.rise.nowCents),
          percent: Math.round(d.rise.risePercentBps / 10) / 10,
          extraPerYear: money(d.rise.yearlyExtraCents),
          usualPercent: d.rise.usualBps / 100,
          usualIs: d.localRent.label,
          worthAskingAbout: d.rise.askAbout,
        }
      : null,
    rentReporting: d.reporting.on
      ? { on: true, since: d.reporting.since }
      : {
          on: false,
          monthlyFee: money(d.reporting.monthlyFeeCents),
          note: d.reporting.note,
          howToTurnOn:
            "The person taps yes in the chat or on their rent page; nothing is reported before.",
        },
    deposits: d.deposits.map((x) => ({
      amount: money(x.amountCents),
      state: x.state,
      status: x.view.status,
      dueBack: x.view.dueOn,
      daysLeft: x.view.daysLeft,
      rule: x.view.rule.note,
      source: x.view.rule.source,
    })),
  };
}

export function creditMonthlyToolOutput(d: CreditMonthly) {
  if (!d.available) return { note: "Nothing on credit to check this month." };
  return {
    month: d.month,
    doneOn: d.checkedOn ?? "worked out just now; Jane's own pass hasn't run this month",
    level: d.level,
    items: d.items.map((i) => ({
      title: i.title,
      status:
        i.status === "tap" ? "needs the person" : i.status === "done" ? "done by Jane" : "fine",
      text: i.text,
      ...(i.link ? { page: i.link.href } : {}),
    })),
    janeDidByHerself: d.did,
    noHardPullsWithoutATap: true,
  };
}

export function borrowingPowerToolOutput(
  d: BorrowingPower,
  money: (cents: number) => string,
  home: HomeMeasure | null = null,
) {
  if (!d.available) return { note: "No lending partner for this person's accounts yet." };
  const both = homeVsBorrow(home, mortgageOf(d.figures));
  return {
    // "Can I afford a house?" measures it another way: say both, with this sentence.
    ...(both ? { whyTheHomeYouCouldAffordDiffers: both } : {}),
    // The partner (the stand-in) is only there in demo advice mode, so these are demo advice.
    demoAdvice: true,
    label: DEMO_ADVICE_LABEL,
    checkedOn: d.checkedOn,
    softChecksOnly: true,
    score: d.score === null ? "not pulled yet; a middling score is assumed" : d.score,
    scorePulledOn: d.scoreOn,
    figures: d.figures.map((f) =>
      !f.available
        ? { product: f.product, available: false, why: f.why, whatWouldHelp: f.improve }
        : f.product === "card"
          ? {
              product: "card",
              likelyRatePercent: (f.aprBps ?? 0) / 100,
              likelyLimit: money(f.limitCents),
              limitIsAGuess: true,
              checkedOn: d.checkedOn,
              whatWouldHelp: f.improve,
            }
          : {
              product: f.product,
              upTo: money(f.amountCents),
              likelyRatePercent: (f.aprBps ?? 0) / 100,
              lender: f.lender,
              termMonths: f.termMonths,
              monthlyPayment: money(f.paymentCents),
              fees: money(f.feeCents),
              limitSetBy: f.binding === "dti" ? "debt-to-income" : "a comfortable payment",
              checkedOn: d.checkedOn,
              whatWouldHelp: f.improve,
            },
    ),
    changedSinceLastCheck: d.changes,
    page: "/loans/borrow",
  };
}

export function familyCreditToolOutput(d: FamilyCredit, money: (cents: number) => string) {
  return {
    cosigned: {
      loans: d.entries
        .filter((e) => e.kind === "cosigned")
        .map((e) => ({
          for: e.person,
          owed: e.balanceCents === null ? null : money(e.balanceCents),
          monthlyPayment: e.monthlyPaymentCents === null ? null : money(e.monthlyPaymentCents),
          missedPayment: e.missed,
        })),
      totalOwedOnThem: money(d.cosign.exposureCents),
      yourDebtPaymentsShareOfIncome: {
        before: d.cosign.shareBefore === null ? null : Math.round(d.cosign.shareBefore * 100),
        withCosignedCountedInFull:
          d.cosign.shareWith === null ? null : Math.round(d.cosign.shareWith * 100),
      },
      whatThisMeans: d.cosigning.facts,
      legal: d.cosigning.legalNote,
    },
    otherWaysToHelp: d.advice
      ? {
          authorizedUser: {
            cardToAddTo: d.bestCard
              ? {
                  name: d.bestCard.name,
                  percentUsed: Math.round((d.bestCard.au.utilisation ?? 0) * 100),
                }
              : "None is used under 30% of its limit.",
            addedPersonMayGainPoints: d.authorizedUser.addedGainsPoints,
            risk: d.authorizedUser.primaryRisk,
            removal: d.authorizedUser.removal,
          },
          firstCardForAStudent: {
            under21: d.firstCard.under21Rule,
            options: d.firstCard.options,
            habits: d.firstCard.habits,
          },
          startingAFileMightSave: money(d.fileStartCents),
        }
      : "Only for the demo bank.",
    recordedByThePerson: d.entries
      .filter((e) => e.kind !== "cosigned")
      .map((e) => ({ kind: e.kind, person: e.person })),
  };
}

// The options card (spec step 282) rides along: the chat shows it as the pick-one card. Jane's
// pick and how sure Jane is are only given in demo advice mode, with its label.
export function loanFitToolOutput(
  view: FitView,
  money: (cents: number) => string,
  advice: boolean = view.advice,
) {
  if (!view.available)
    return { note: "No lending partner for this person's accounts yet, so there are no offers." };
  // Something to borrow, but no lender quotes an amount this small: the same answer as the chat.
  if (view.options.length === 0 && view.ineligible.length === 0 && view.baseline) {
    return {
      note: "Nothing fits right now.",
      why: [`No lender prices a loan as small as ${money(view.amountCents)}.`],
      whatWouldHelp: [`Paying ${view.baseline.label} down directly is simplest.`],
    };
  }
  if (view.options.length === 0) {
    return {
      note: "Nothing fits right now.",
      why: view.ineligible.slice(0, 3).map((i) => i.reason),
      whatWouldHelp: view.whatWouldHelp,
    };
  }
  const card = fitCard(view, advice);
  return {
    demoAdvice: advice,
    ...(advice ? { label: DEMO_ADVICE_LABEL } : {}),
    need: view.need,
    checkedOn: view.checkedOn,
    pick: advice ? view.pick : null,
    confidence:
      advice && view.confidence
        ? `${view.confidence.percent}% sure: ${view.confidence.reason}`
        : null,
    options: view.options.map((o) => ({
      id: o.id,
      label: FIT_LABEL_TEXT[o.label],
      headline: o.headline,
      rate: `${formatRate(o.aprBps)}`,
      months: o.termMonths,
      monthlyPayment: money(o.paymentCents),
      totalCost: money(o.totalCostCents),
      fees: money(o.feeCents),
      savesVersusWhatYouHave: o.savesCents === null ? null : money(o.savesCents),
      comfortable: o.comfortable,
      details: o.details,
    })),
    // "Why that one?": the reason, and the pick against each other option, worked out here so
    // the answer can say the difference without doing sums.
    whyThePick: advice ? whyThePick(view, money, card) : null,
    // "What about a shorter (or longer) term?": the best loan's lender at each term it offers.
    otherTerms: view.terms ? otherTerms(view.terms, money) : null,
    assumptions: view.assumptions,
    optionCard: card,
  };
}

// "$45.00 more a month", "$120.00 less", "the same".
const differs = (cents: number, money: (cents: number) => string, more: string, less: string) =>
  cents === 0 ? "the same" : cents > 0 ? `${money(cents)} ${more}` : `${money(-cents)} ${less}`;

function whyThePick(view: FitView, money: (cents: number) => string, card: OptionCard | null) {
  const pick = view.options.find((o) => o.id === view.pick);
  if (!pick) return null;
  return {
    pick: pick.lender,
    reason: card?.options.find((o) => o.id === pick.id)?.whyThisOne ?? null,
    confidence: view.confidence
      ? `${view.confidence.percent}% sure: ${view.confidence.reason}`
      : null,
    comfortable: pick.comfortable,
    paymentShareOfTakeHome:
      pick.paymentShare === null ? null : `${Math.round(pick.paymentShare * 100)}%`,
    versusTheOthers: view.options
      .filter((o) => o.id !== pick.id)
      .map((o) => ({
        option: o.lender,
        months: o.termMonths,
        // The pick against this one.
        pickMonthlyPayment: differs(
          pick.paymentCents - o.paymentCents,
          money,
          "more a month",
          "less a month",
        ),
        pickPaidInAll: differs(pick.totalCostCents - o.totalCostCents, money, "more", "less"),
        thisOneIsComfortable: o.comfortable,
      })),
  };
}

function otherTerms(terms: FitTerms, money: (cents: number) => string) {
  const best = terms.options.find((t) => t.id === terms.bestId)!;
  return {
    lender: terms.lender,
    comparedWith: `${terms.lender} at ${best.termMonths} months, the best loan`,
    shorterMonths:
      terms.options.filter((t) => t.termMonths < best.termMonths).at(-1)?.termMonths ?? null,
    longerMonths: terms.options.find((t) => t.termMonths > best.termMonths)?.termMonths ?? null,
    terms: terms.options.map((t) => ({
      months: t.termMonths,
      rate: `${formatRate(t.aprBps)}`,
      monthlyPayment: money(t.paymentCents),
      totalInterest: money(t.interestCents),
      fees: money(t.feeCents),
      totalCost: money(t.totalCostCents),
      comfortable: t.comfortable,
      isTheBestLoan: t.id === terms.bestId,
      monthlyPaymentVersusBest: differs(t.paymentDiffCents, money, "more a month", "less a month"),
      interestVersusBest: differs(t.interestDiffCents, money, "more interest", "less interest"),
    })),
  };
}
