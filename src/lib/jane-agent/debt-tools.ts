import type Anthropic from "@anthropic-ai/sdk";
import { MAX_DEBT_EXTRA_CENTS } from "@/config/debt";
import { noInput } from "@/lib/ask/tools";

// Claude's tools about debts in Jane's chat (spec Phase Y): read-only, over the same debt
// book as the loans page (src/lib/debts.ts). What each one hands back is built in
// ./debt-tool-outputs.ts.

const REFINANCE_TOOL: Anthropic.Tool = {
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
      "What Jane does about the person's debts on its own at their debt autopilot level (step by step), loan and card payments due in the next month (soonest first, overdue first), payments due just before payday with the drafted request to move the date, rate changes the bank reported, and whether Jane started the payoff plan itself. Jane never applies for credit, moves money or signs without a tap.",
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
      "The person's credit cards and their rewards, from a year of their own spending (demo-bank people only, from a stand-in card catalog; nothing for real accounts until a card partner is connected): spending by kind (dining, groceries, gas, travel, streaming, online, everything else), each card's rewards, what it earns and its annual fee, whether each fee pays for itself against the best no-fee card, which card to use for each kind, and up to three cards that would earn more after their fee, with any sign-up bonus. Applying is a hard credit check and only ever the person's tap (the credit_card.apply button); Jane never applies on its own. Demo advice.",
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
      "Help when the person's money is tight (demo-bank people only): whether the checking forecast dips under its cushion in the next month and when, the bills before then in the order to pay them (housing, utilities and insurance first, never delayed), the requests Jane has prepared (moving a due date after payday, a hardship program, a lower card rate, a late fee waived) with the exact text of each and whether it was sent, and what each lender answered. Sending any request needs the person's tap (the tight.send button); Jane never sends one on its own.",
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
      "The person's medical bills (demo-bank people only; nothing for real accounts): bills of $100 or more found in recent payments to doctors, dentists and hospitals (pharmacy left out) plus any they typed in, whether they have an active health plan on file, and for each bill the requests Jane has written (an itemized bill, a check against their insurance, a financial assistance application for bills of $500 or more, and a payment plan with no interest for bills of $300 or more) with the exact letter, whether it was sent and what the provider answered, including what assistance took off. Amounts are the bills' own. Sending any request needs the person's tap (the medical.send button); Jane never sends one on its own.",
    input_schema: noInput,
  },
  {
    name: "credit_report_fixes",
    description:
      "Collections and possible errors on the person's credit report, from a monthly soft pull (demo-bank people only, a stand-in report; nothing for real accounts): each item with its creditor, amount and what's wrong, whether a dispute already fixed it, and the letters Jane wrote for it (a debt validation letter to a collector under the Fair Debt Collection Practices Act, section 809(b), with the last day to ask; a dispute to the three bureaus under the Fair Credit Reporting Act, section 611, which they must answer within 30 days) with the exact text, whether each was sent and what came back. Sending a letter needs the person's tap (the creditfix.send button); Jane never sends one on its own.",
    input_schema: noInput,
  },
  {
    name: "card_interest",
    description:
      "How much interest the person's cards cost and how to cut it (demo-bank people only; nothing for real accounts): each card's balance, rate, a year of interest, what paying its usual payment now instead of on the due date saves, when its statement closes; any 0% promotions they typed in with the days left, the monthly amount that clears the balance by the end, whether they're on pace, and (for deferred interest) what missing the end would cost, with the deadline Jane raised when off pace; and for each card at 15% or more with a balance the written request for a lower rate with a call script and the yearly saving, whether it was sent and what the lender answered. Sending a request needs the person's tap (the cardrate.send button); Jane never sends one on its own.",
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
      "Money between the person and family or friends: payment-app transfers (Venmo, Zelle, Cash App) of $100 or more, or noted like a loan, that Jane asked about and haven't been answered (a transfer is a loan only after the person says so); loans the person confirmed, lent or borrowed, with the balance after the transfers that came back and whether a kind reminder for them to send themselves is ready on the family page (once a loan has been open a month); the other person appears by initials only, never by name; loans they co-signed with whether a payment looks late; and the household's shared debts with each person's half of the monthly payment. Jane never messages the other person. Confirming or dismissing a transfer is the person's tap (the famloan.yes and famloan.no buttons).",
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
    name: "renting",
    description:
      "Renting, counted: the person's rent as found in their payments (monthly amount, any increase against what is usual, using a stand-in local trend), whether their rent is being reported to the credit bureaus (only ever after their own yes; the monthly fee and what reporting can and can't do are stated), and any security deposits they have told Jane about with the day each is due back after moving out (days from the state's law, with the citation, to be confirmed against the lease). Facts and the person's own choices; Jane reports nothing and sends nothing itself.",
    input_schema: noInput,
  },
  {
    name: "credit_monthly",
    description:
      "The monthly credit check-up Jane does on its own: the day it did it and, for this month, each item with its status (done by Jane, needs the person, or fine): its soft checks of loan rates and what the person could borrow, a cheaper rate on a loan (the fit engine's refinance pick with fees counted), car loan add-ons worth cancelling with the refund, costly borrowing creeping back in the last 30 days, a security deposit due back or a rent rise worth asking about, and a lower-rate request to a card (sent by Jane only at Handle everything, once a month). Each item that needs the person names the page where they act. Nothing that runs a hard credit check, applies for credit, opens an account or cancels cover happens without the person's tap.",
    input_schema: noInput,
  },
  {
    name: "borrowing_power",
    description:
      "What the person could borrow, kept current: for a mortgage, a car loan, a personal loan and a credit card, the likely amount (the most whose payment stays inside the lender's debt-to-income limit and a comfortable share of take-home pay, from the same fit engine as the loan options) and the likely rate, lender, term, payment and fees from the lender stand-in's soft prequalification (soft checks never touch the score), the day it was checked, the score it was priced by and the day that score was pulled, what would improve each (the next score band's rate, debt payments that set the limit), and what moved since the check before. Estimates, not offers; a card's limit is a stated guess from income. Nothing is applied for: a hard pull only ever follows the person's own tap.",
    input_schema: noInput,
  },
  {
    name: "family_credit",
    description:
      "Helping family with credit: what adding someone as an authorized user on one of the person's cards would do to both credit reports (the card's use against its limit, a range of points the added person can gain, and the risk to the primary), the usual first cards for a student and the rule for under 21s, and co-signing: the loans the person has told Jane they co-signed, counted in full in their own debt-to-income (before and after), what lands on them if the other person misses, and any missed payments they reported. Facts and stated ranges; suggestions only in demo advice mode; what a lender may do depends on the contract, a question for counsel.",
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
      "A straight answer, in three sentences or fewer, to a money decision about debt or credit, from the person's own numbers: pay_or_invest (their highest-rate debt against what investing has historically returned), consolidate and personal_loan (the best stand-in offer and what it saves with fees counted), savings_or_debt (what cash beyond the emergency cushion would save on the worst card), close_card (what closing does to their limits and card use), payoff_hurts (it doesn't), payday_loan (its yearly rate and cheaper options), student_early, overdraft (whether checking is forecast to go below zero this month, when and by how much) bnpl (whether buy now, pay later suits them), save_each_month (what they keep now against the common 20% target) and rent_or_buy (their rent against the home the 28/36 rules allow). Give the sentences as the answer. They already say what is math and, only in demo advice mode, what Jane would pick; do not add a recommendation of your own. Start with the verdict in words; offer no button unless they asked you to do something; for any amount these sentences don't give, use the calculate tool.",
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
      "The yearly debt review (once a year, and after a raise, a new loan or a missed payment): when the last one was done and why, whether one is due now, and each item with whether Jane did it itself, it waits for the person's tap, or it is fine: payments timed to statement dates, 0% promotions on pace, lower-rate requests, PMI and escrow, and credit score goals. Jane acts on its own only within the debt autopilot level and caps (a payment before a statement at Handle the safe stuff; also a lower-rate request at Handle everything) and nothing above a cap happens without the person's tap; the buttons are credit_build.pay, cardrate.send, homeeq.sent and creditgoal.done.",
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
      "The person's loan applications for refinance offers (spec step 112): the lender, the loan it pays off, the terms (rate, months, monthly payment, fee, total, saving) and where each stands: draft (prepared, not sent), approved (waiting for their yes), declined, accepted, funded (old loan being paid off), paid_off (old loan at zero) or withdrawn. Jane never submits or accepts one itself.",
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
  renting: "Looking at your rent…",
  borrowing_power: "Checking what you could borrow…",
  credit_monthly: "Going over this month's credit check-up…",
  family_credit: "Looking at helping with credit…",
  debt_decision: "Working it out with your numbers…",
  loan_fit: "Finding the loan that fits you…",
};
