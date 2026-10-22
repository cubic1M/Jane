import {
  COUNSELOR_REFERRALS,
  COUNSEL_POINTER,
  DEBT_FACTS,
  DMP_NOTE,
  HARDSHIP_PROGRAMS,
} from "@/config/debt-trouble";
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
import type { DebtReview } from "@/lib/debt-review";
import type { DebtTrouble } from "@/lib/debt-trouble";
import type { HomeEquity, ProjectComparison } from "@/lib/home-equity";
import { REWARD_CATEGORY_LABELS } from "@/config/credit-cards";
import type { DebtAutopilot } from "@/lib/debt-autopilot";
import { PMI_SOURCE } from "@/config/debt";
import type { FitView } from "@/lib/fit";
import { fitCard } from "@/lib/fit-card";
import type { OptionCard } from "@/lib/option-card";
import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { FIT_LABEL_TEXT, type FitTerms } from "@/planning/fit";
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
    name: "credit_cards",
    description:
      "The person's credit cards and their rewards, from a year of their own spending (demo-bank people only, from a stand-in card catalog; nothing for real accounts until a card partner is connected): spending by kind (dining, groceries, gas, travel, streaming, online, everything else), each card's rewards, what it earns and its annual fee, whether each fee pays for itself against the best no-fee card, which card to use for each kind, and up to three cards that would earn more after their fee, with any sign-up bonus. Applying is a hard credit check and only ever the person's tap (the credit_card.apply button); Jane never applies by herself. Demo advice.",
    input_schema: noInput,
  },
  {
    name: "credit_building",
    description:
      "Building the person's credit (demo-bank people only; nothing for real accounts): the card whose statement closes next, the day it closes, what to pay before then so card use reported is under 30% or 10%, whether Jane or the person already scheduled it (through the money-movement stand-in), the on-time payment streak in months, whether the credit file is thin with credit-builder stand-ins (a secured card, a credit-builder loan), and the score simulator's estimate after each change (paying cards down, a year on time, a new card, a builder loan). Every simulator figure is an estimate, never a promise. Paying from the chat and opening a builder account each need the person's tap.",
    input_schema: noInput,
  },
  {
    name: "bnpl_installments",
    description:
      "The person's buy now, pay later plans and their installments: each plan's payment, how often, next due date and balance when known, every installment over the next month (soonest first) from the plans' own schedules, which of them the checking forecast does not count yet (Jane takes those off safe to spend), and which Pay in 4 plans are free to pay off now (no interest or fee for paying early). With total_cents, also whether a new Pay in 4 plan of that total (four payments two weeks apart) would take checking under its cushion, from the checking forecast. Paying a plan off needs the person's tap (the bnpl.payoff button).",
    input_schema: {
      type: "object" as const,
      properties: {
        total_cents: {
          type: "integer" as const,
          description:
            "The total of a new plan to check against the forecast, in cents (optional).",
        },
      },
    },
  },
  {
    name: "tight_money",
    description:
      "Help when the person's money is tight (demo-bank people only): whether the checking forecast dips under its cushion in the next month and when, the bills before then in the order to pay them (housing, utilities and insurance first, never delayed), the requests Jane has prepared (moving a due date after payday, a hardship program, a lower card rate, a late fee waived) with the exact text of each and whether it was sent, and what each lender answered. Sending any request needs the person's tap (the tight.send button); Jane never sends one by herself.",
    input_schema: noInput,
  },
  {
    name: "car_purchase",
    description:
      "Planning a car purchase (demo-bank people only; nothing for real accounts): what the person can afford from their own income (all-in monthly cost, including the loan payment, insurance scaled from their auto policy, fuel from their gas spending, upkeep and registration, at most 20% of income), a comfortable price and monthly cost to aim for (about 12% of income) and, only as the ceiling, the highest price that fits (say the comfortable one first, never the ceiling as a target), the preapproval loan offers compared by total cost with fees (cheapest first), and, with the dealer's rate and months, whether the dealer's financing costs more than the best preapproval. Every assumption is listed. Nothing is applied for here.",
    input_schema: {
      type: "object" as const,
      properties: {
        price_cents: {
          type: "integer" as const,
          description: "A car's price in cents (optional).",
        },
        dealer_apr_percent: {
          type: "number" as const,
          description: "The dealer's APR, e.g. 7.9 (optional).",
        },
        dealer_months: {
          type: "integer" as const,
          description: "The dealer's loan term in months (optional).",
        },
      },
    },
  },
  {
    name: "home_purchase",
    description:
      "Planning a home purchase, for everyone from their own income and debts (the lender partner's offers and the demo advice label only for demo-bank people): the most home the person can afford under the usual rules (housing at most 28% of gross income, all debt at most 36%, gross estimated from take-home), the monthly cost at a price (loan, property tax, insurance, mortgage insurance/PMI while the down payment is under 20%), the cash needed up front (down payment and estimated closing costs), a savings plan from their real monthly cash flow and savings (how many months, or what to save a month by a date), the mortgage offers compared by total cost with closing costs, and every assumption. Starting the down payment goal needs the person's tap (the home.goal button).",
    input_schema: {
      type: "object" as const,
      properties: {
        price_cents: {
          type: "integer" as const,
          description: "A home's price in cents (optional).",
        },
      },
    },
  },
  {
    name: "medical_bills",
    description:
      "The person's medical bills (demo-bank people only; nothing for real accounts): bills of $100 or more found in recent payments to doctors, dentists and hospitals (pharmacy left out) plus any they typed in, whether they have an active health plan on file, and for each bill the requests Jane has written (an itemized bill, a check against their insurance, a financial assistance application for bills of $500 or more, and a payment plan with no interest for bills of $300 or more) with the exact letter, whether it was sent and what the provider answered, including what assistance took off. Amounts are the bills' own. Sending any request needs the person's tap (the medical.send button); Jane never sends one by herself.",
    input_schema: noInput,
  },
  {
    name: "credit_report_fixes",
    description:
      "Collections and possible errors on the person's credit report, from a monthly soft pull (demo-bank people only, a stand-in report; nothing for real accounts): each item with its creditor, amount and what's wrong, whether a dispute already fixed it, and the letters Jane wrote for it (a debt validation letter to a collector under the Fair Debt Collection Practices Act, section 809(b), with the last day to ask; a dispute to the three bureaus under the Fair Credit Reporting Act, section 611, which they must answer within 30 days) with the exact text, whether each was sent and what came back. Sending a letter needs the person's tap (the creditfix.send button); Jane never sends one by herself.",
    input_schema: noInput,
  },
  {
    name: "card_interest",
    description:
      "How much interest the person's cards cost and how to cut it (demo-bank people only; nothing for real accounts): each card's balance, rate, a year of interest, what paying its usual payment now instead of on the due date saves, when its statement closes; any 0% promotions they typed in with the days left, the monthly amount that clears the balance by the end, whether they're on pace, and (for deferred interest) what missing the end would cost, with the deadline Jane raised when off pace; and for each card at 15% or more with a balance the written request for a lower rate with a call script and the yearly saving, whether it was sent and what the lender answered. Sending a request needs the person's tap (the cardrate.send button); Jane never sends one by herself.",
    input_schema: noInput,
  },
  {
    name: "student_long_game",
    description:
      "The long game on the person's student loan: Public Service Loan Forgiveness counted month by month (qualifying payments counted of 120, remaining, the date it's forgiven if they keep paying on time, and the grid of months seen), the next dates to certify their employer and to recertify an income-driven plan (both on their deadlines list), when the plan they're on forgives what's left and how much, the tax on forgiven debt (PSLF forgiveness isn't taxed; income-driven forgiveness is generally taxed federally from 2026; an estimate sized for their tax plan), and whether refinancing makes sense: a private loan can be worth refinancing when an offer is at least a point lower; a federal loan is never refinanced away from forgiveness without saying what's lost (PSLF and income-driven forgiveness, income-based payments, deferment and discharge). Plan rules and their sources are in config.",
    input_schema: noInput,
  },
  {
    name: "family_loans",
    description:
      "Money between the person and family or friends: payment-app transfers (Venmo, Zelle, Cash App) of $100 or more, or noted like a loan, that Jane asked about and haven't been answered (a transfer is a loan only after the person says so); loans the person confirmed, lent or borrowed, with the balance after the transfers that came back and the kind reminder drafted for them to send themselves once a loan has been open a month; loans they co-signed with whether a payment looks late; and the household's shared debts with each person's half of the monthly payment. Jane never messages the other person. Confirming or dismissing a transfer is the person's tap (the famloan.yes and famloan.no buttons).",
    input_schema: noInput,
  },
  {
    name: "credit_goals",
    description:
      "The credit score plans the person has for a goal (demo-bank people only, a stand-in score; every figure is an estimate from the score simulator, never a promise): for each, the target score and date, what the goal is for (a mortgage, a car), the score now, whether the plan reaches the target and the best it shows if not, the month-by-month plan (what to pay toward cards and the estimated score after each month), this month's checklist with what's done (pay before the statement closes, keep card accounts open, no new applications, on-time payments, and a rapid rescore before a mortgage application), and the total to pay down. Starting a plan and ticking off a month are the person's taps (the creditgoal.start and creditgoal.done buttons).",
    input_schema: noInput,
  },
  {
    name: "costly_borrowing",
    description:
      "Costly short-term borrowing found in the last year of the person's payments: payday loans (matched proceeds and repayments), card cash advances (fee plus interest from day one), repeated overdraft fees and pay advance apps (tips and fees), each with how many times, what it cost in dollars, the yearly rate that works out to and how that was worked out (stated assumptions), and whether it's a cycle. In demo advice mode, the cheaper ways out: a credit union payday alternative loan (capped at 28%) with its cost against the payday loan's, an employer pay advance, a buffer built over six months, and steps to stop the cycle. Facts about what was borrowed and what it cost; the way out is advice, the choice is the person's.",
    input_schema: noInput,
  },
  {
    name: "mortgage_money",
    description:
      "Recast, refinance or pay extra on the person's mortgage (demo advice mode only): for a lump sum (lump_cents) and/or extra money each month (extra_monthly_cents), the mortgage as it is (payment, end date, total interest) and each way to use the money: extra principal (same payment, paid off sooner), a recast (lower payment, same rate and end date, with the servicer's fee), and a refinance of what's left at the best stand-in mortgage offer (with its closing fees), each with total interest, the interest saved against doing nothing with fees counted, and the month and date its fee pays back; and the same money invested instead as a low to high range of gain, not guaranteed, against the certain return of paying down. Fees and rules come from config with sources. Show both sides and leave the choice to the person.",
    input_schema: {
      type: "object" as const,
      properties: {
        lump_cents: { type: "integer" as const, description: "A lump sum in cents (optional)." },
        extra_monthly_cents: {
          type: "integer" as const,
          description: "Extra each month in cents (optional).",
        },
      },
    },
  },
  {
    name: "loan_fit",
    description:
      "The best loan for what the person needs, picked from their credit, debt-to-income, cash and the lender stand-in's offers (demo-bank people only): for need car, home, refinance, consolidation or personal, two to four options, each with its rate, term, monthly payment, total cost over the term with fees (not just the rate), the payment as a share of take-home, when the fee pays back, and what it saves against what they have now; which options are comfortable; Jane's pick with a confidence percentage and its reason; the offers that don't fit and why; for why that one, the reason for the pick and the pick against each other option (the differences already worked out); for a shorter or longer term, the best loan's lender at each term it offers, with the payment, total interest and the differences against the best loan already worked out; and the options card the chat shows. Give amount_dollars for a car, home or personal loan; a refinance takes the debt with the highest rate (or debt_key) and a consolidation takes the person's cards. The pick is demo advice; nothing is applied for here.",
    input_schema: {
      type: "object" as const,
      properties: {
        need: {
          type: "string" as const,
          enum: ["car", "home", "refinance", "consolidation", "personal"],
        },
        amount_dollars: { type: "number" as const },
        debt_key: { type: "string" as const },
      },
      required: ["need"],
    },
  },
  {
    name: "debt_decision",
    description:
      "A straight answer, in three sentences or fewer, to a money decision about debt or credit, from the person's own numbers: pay_or_invest (their highest-rate debt against what investing has historically returned), consolidate and personal_loan (the best stand-in offer and what it saves with fees counted), savings_or_debt (what cash beyond a month of spending would save on the worst card), close_card (what closing does to their limits and card use), payoff_hurts (it doesn't), payday_loan (its yearly rate and cheaper options), student_early, overdraft (whether checking is forecast to go below zero this month, when and by how much) bnpl (whether buy now, pay later suits them), save_each_month (what they keep now against the common 20% target) and rent_or_buy (their rent against the home the 28/36 rules allow). Give the sentences as the answer. They already say what is math and, only in demo advice mode, what Jane would pick; do not add a recommendation of your own. Start with the verdict in words; offer no button unless they asked you to do something; for any amount these sentences don't give, use the calculate tool.",
    input_schema: {
      type: "object" as const,
      properties: {
        which: {
          type: "string" as const,
          enum: [
            "pay_or_invest",
            "consolidate",
            "personal_loan",
            "savings_or_debt",
            "close_card",
            "payoff_hurts",
            "payday_loan",
            "student_early",
            "overdraft",
            "bnpl",
            "save_each_month",
            "rent_or_buy",
          ],
        },
      },
      required: ["which"],
    },
  },
  {
    name: "car_loan",
    description:
      "The car loan the person already has: its balance, rate and payment; in demo advice mode the best refinance offer compared by TOTAL cost (not the payment) with fees and break-even, and whether rates fell or the credit band improved since the last check; and dealer add-ons financed into it (GAP, extended warranty, service contract) found in the payments or typed in, each with the estimated refund if cancelled (unused months of the term, less the usual cancellation fee) and the drafted cancellation letter. The person confirms what a payment was (caraddon.yes) and sends the cancellation themselves (caraddon.mine) or asks the concierge team to (caraddon.team); Jane sends nothing. Refunds are estimates; the contract has the final say.",
    input_schema: noInput,
  },
  {
    name: "debt_review",
    description:
      "The yearly debt review (once a year, and after a raise, a new loan or a missed payment): when the last one was done and why, whether one is due now, and each item with whether Jane did it herself, it waits for the person's tap, or it is fine: payments timed to statement dates, 0% promotions on pace, lower-rate requests, PMI and escrow, and credit score goals. Jane acts by herself only within the debt autopilot level and caps (a payment before a statement at Handle the safe stuff; also a lower-rate request at Handle everything) and nothing above a cap happens without the person's tap; the buttons are credit_build.pay, cardrate.send, homeeq.sent and creditgoal.done.",
    input_schema: noInput,
  },
  {
    name: "debt_trouble",
    description:
      "When debt is too much: the person's monthly debt payments as a share of their income (and whether that is over the share where Jane brings it up), what to ask each lender for (hardship programs, by debt), a sketch of a debt management plan through a nonprofit credit counselor from their own cards (months and interest at a typical negotiated rate, an assumption and not an offer) with a referral list, and the reviewed facts about debt settlement, bankruptcy and tax on forgiven debt. These are facts and doors to knock on: never tell the person to file for bankruptcy, settle or stop paying, never give legal or tax advice, repeat the facts word for word, and point legal questions to a bankruptcy attorney or nonprofit legal aid. Jane sends nothing.",
    input_schema: noInput,
  },
  {
    name: "home_equity",
    description:
      "A home's equity, used well: PMI measured against the home's original value (what the person told Jane; the balance that lets them ask to cancel at 80% and the 78% where it ends by itself, with dates at the current payment, and the drafted request), the escrow in the payment checked against the property tax and insurance bills the person gave (the surplus above a year of bills and the two-month cushion, or a shortage, with the drafted refund request), and, in demo advice mode, a HELOC, a cash-out refinance and a personal loan compared for a project (pass project_cents and optionally years) with the total cost of each (stand-in lender terms, not offers). Jane never sends a request to a servicer or applies for anything: the person sends it and taps homeeq.sent. Rules from the CFPB and Regulation X.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_cents: {
          type: "integer" as const,
          description: "A home project's cost in cents, to compare ways to pay for it (optional).",
        },
        years: {
          type: "integer" as const,
          description: "Years to pay a HELOC or personal loan back (optional, default 10).",
        },
      },
    },
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
  cards: { label: "See your cards", href: "/loans/cards" },
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
  credit_cards: "Checking your card rewards…",
  credit_building: "Working out how to build your credit…",
  bnpl_installments: "Checking your buy now, pay later installments…",
  tight_money: "Looking at your month ahead…",
  car_purchase: "Working out what car you can afford…",
  home_purchase: "Working out what home you can afford…",
  medical_bills: "Looking at your medical bills…",
  credit_report_fixes: "Checking your credit report…",
  card_interest: "Looking at your card interest…",
  student_long_game: "Looking at your student loan's long game…",
  family_loans: "Looking at who owes whom…",
  credit_goals: "Looking at your credit plan…",
  home_equity: "Checking your home loan…",
  debt_trouble: "Looking at your options…",
  debt_review: "Going over your debts…",
  car_loan: "Looking at your car loan…",
  mortgage_money: "Comparing ways to use the money…",
  costly_borrowing: "Looking for costly borrowing…",
  debt_decision: "Working it out with your numbers…",
  loan_fit: "Finding the loan that fits you…",
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
      rate: `${(o.offer.aprBps / 100).toFixed(2)}%`,
      monthly: money(o.monthlyCents),
      totalCost: money(o.totalCents),
      fees: o.offer.feeLabel,
    })),
    dealer: car.dealer && {
      verdict: car.dealer.verdict,
      monthly: money(car.dealer.monthlyCents),
      totalCost: money(car.dealer.totalCents),
      costsMoreThanBestPreapproval: money(car.dealer.extraCents),
    },
    assumptions: car.assumptions,
  };
}

export function homeToolOutput(home: HomeBuying, money: (cents: number) => string) {
  if (!home.costs || !home.affordability || !home.saving) {
    return { note: "Not enough income history to say what home fits." };
  }
  const c = home.costs;
  return {
    demoAdvice: home.advice,
    rate: `${((home.aprBps ?? 0) / 100).toFixed(2)}%${home.rateIsOffer ? " (a lender's offer)" : " (a typical rate, not an offer)"}`,
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
      rate: `${(o.offer.aprBps / 100).toFixed(2)}%`,
      monthlyForLoan: money(o.monthlyCents),
      totalCostWithClosing: money(o.totalCents),
      closing: o.offer.feeLabel,
    })),
    assumptions: home.assumptions,
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
      rate: `${(c.aprBps / 100).toFixed(2)}%`,
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
      with: c.parsed.counterparty,
      amount: money(Math.abs(c.transfer.amountCents)),
      on: c.transfer.date,
      note: c.parsed.note,
      wouldBe: c.kind,
    })),
    loans: data.loans.map((l) => ({
      kind: l.kind,
      with: l.counterparty,
      lentOrBorrowed: money(l.principalCents),
      stillOwed: money(l.balanceCents),
      openedOn: l.openedOn,
      paidBack: l.repaid.map((r) => ({ on: r.date, amount: money(r.cents) })),
      reminderToSendYourself: l.reminder?.text ?? null,
    })),
    cosigned: data.cosigned.map((c) => ({
      loan: c.debtName,
      for: c.counterparty,
      looksLate: c.missed,
      pastDue: c.pastDueCents === null ? null : money(c.pastDueCents),
      noteToSendYourself: c.text,
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
      whatToAsk: HARDSHIP_PROGRAMS[d.kind],
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

// The options card (spec step 282) rides along: the chat shows it as the pick-one card. Jane's
// pick and how sure she is are only given in demo advice mode, with its label.
export function loanFitToolOutput(
  view: FitView,
  money: (cents: number) => string,
  advice: boolean = view.advice,
) {
  if (!view.available)
    return { note: "No lending partner for this person's accounts yet, so there are no offers." };
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
      rate: `${(o.aprBps / 100).toFixed(2)}%`,
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
      rate: `${(t.aprBps / 100).toFixed(2)}%`,
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
