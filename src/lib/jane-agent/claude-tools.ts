import { adviceMode } from "@/lib/advice-mode";
import { loadPractice } from "@/lib/practice/portfolio";
import { PRACTICE_ONLY_NOTE } from "./investments/practice-copy";
import { dollarFigures } from "@/lib/guardrails";
import { decisionReply, loadDecisionFacts } from "./decision";
import { parseDecision } from "./decision-intents";
import { mattersBlock } from "./primer-matters";
import { loadBankFees } from "@/lib/bank-fees";
import { loadSnapshotFast, refreshSnapshot } from "./snapshot-store";
import { INSURANCE_TOOLS, isInsuranceTool, runInsuranceTool } from "./insurance/tools";
import type Anthropic from "@anthropic-ai/sdk";
import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { MAX_AFFORD_CENTS } from "@/config/afford";
import { CHAT_PRIMER_TOOLS, CHAT_RUNNERS_UP } from "@/config/agent-chat";
import { LIFE_EVENTS } from "@/config/life-events";
import type { PrismaClient } from "@/generated/prisma/client";
import { budgetSummary } from "@/insights/budgets";
import { loadInsightTransactions } from "@/insights/load";
import { netWorth } from "@/insights/net-worth";
import { ASK_TOOLS, runAskTool, type ToolOutput } from "@/lib/ask/tools";
import { CARD_SELECT, buildCard } from "@/lib/cards";
import { comparisonFor } from "@/lib/compare";
import { frequencyWords } from "@/lib/explain-input";
import { FIGURE_IDS, type FigureId } from "@/config/figures";
import { explainFigure } from "@/lib/figures";
import { openBooks } from "@/lib/books";
import { loadClose } from "@/lib/month-close";
import { loadSteady } from "@/lib/steady-pay";
import { loadMoneyForTwo } from "@/lib/money-for-two";
import { loadTradeoffs } from "@/lib/goal-tradeoffs";
import type { TradeOrder } from "@/planning/goal-tradeoffs";
import { FACT_KEYS } from "@/profile/facts";
import { scopedFor } from "@/lib/db-scoped";
import { loadChanges } from "@/lib/changes";
import { listGoals } from "@/lib/goals";
import { lifeGuessesFor } from "@/lib/life-guesses";
import { loadUpkeep } from "@/lib/plan-upkeep";
import { sectorAutopilots } from "@/lib/sector-autopilot";
import { lastControllerRun } from "@/lib/controller-log";
import { CONTROLLER_STEP_LABELS } from "@/config/controller";
import { rankedFor } from "./priorities";
import { loadDetectionInput } from "@/detection/engine";
import { forecastAccounts } from "@/detection/forecast";
import { FORECAST_DAYS } from "@/config/detection";
import { newestUnreadAlerts } from "@/lib/alerts";
import { householdOf } from "@/lib/household";
import { wholePicture } from "./whole-picture";
import { latestPaycheckPlan } from "@/lib/money-movement/paycheck";
import { listTransfers } from "@/lib/money-movement/transfers";
import { loadBillPay } from "@/lib/money-movement/bill-pay";
import { moneyPartnerFor } from "@/lib/money-movement/partner";
import { healthFor } from "@/lib/health-score";
import { SCENARIOS } from "@/config/what-if";
import { isScenario, whatIf } from "@/lib/what-if";
import { loadLongView } from "@/lib/long-view";
import { loadProfile, sayFact } from "@/lib/profile";
import { storedReport } from "@/lib/monthly-report-store";
import { SECTOR_LABELS, SECTOR_LEVEL_LABELS } from "@/config/autopilot-sectors";
import { provenSavings } from "@/lib/savings-proof";
import { listLifeEvents } from "@/lib/life-events";
import { homeSummary } from "@/lib/home";
import { HEALTH_SAY_IN_WORDS_BELOW } from "@/config/health-score";
import { formatCents } from "@/lib/money";
import { POLICY_KINDS, type PolicyKind } from "@/config/insurance";
import { quotesAnswer } from "./insurance/quotes";
import { calculate, type CalcInput } from "./calculate";
import { affordWindow } from "@/planning/afford";
import type { Scored } from "@/planning/compare";
import { ACTION_HANDLERS } from "./actions";
import { DEBT_CHAT_PAGES, DEBT_TOOLS } from "./debt-tools";
import { isDebtTool, runDebtTool } from "./debt-tools-run";
import { INVESTMENT_TOOLS, isInvestmentTool, runInvestmentTool } from "./investments/tools";
import { NEWS_TOOLS, isNewsTool, runNewsTool } from "./news-tools";
import { PRACTICE_TOOLS, isPracticeTool, runPracticeTool } from "./practice-tools";
import { rebalanceOffer } from "./investments/replies";
import { loadRebalance } from "@/lib/investments/rebalance";
import { monthLabel, type Reply } from "./replies";
import { guessLine } from "./replies-life";
import { BLOCK_KINDS } from "./block-data";
import { listPreferences } from "./preferences";
import { cachedPrimer, keepPrimer } from "./primer-cache";
import { isStale, readStoredPrimer, writeStoredPrimer } from "./primer-store";
import { loadRecurring } from "./recurring";
import { weeklyReview } from "./replies-review";
import { findingCandidate } from "./sources/findings";
import { TAX_TOOLS, isTaxTool, runTaxTool } from "./tax-tools";
import { ACTION_IDS, type ActionId, type MessageAction } from "./types";
import { cryptoTotal } from "@/lib/crypto/crypto";
import { backtestsFor, longDate } from "@/lib/investments/backtest";
import { RISK_LEVELS } from "@/config/investing";
import { formatReturn } from "@/insights/returns";

// The tools Claude gets in Jane's chat (spec step 84). Read-only tools over the person's
// own data, wrapping the same loaders as the pages (and Ask's own tools, src/lib/ask), each
// scoped to the person. Every dollar figure a tool returns is recorded for the guardrails.
// One more, propose_action, can only put buttons from the action registry under the
// answer: Claude never runs an action, the person taps.

type Options = { client: PrismaClient; now: Date };

// Ask's tools, except its findings list: the chat's has the ids propose_action needs.
const FROM_ASK = ASK_TOOLS.filter((t) => t.name !== "list_findings");

// Buttons Claude may offer. Undo isn't one: it belongs to the message it undoes.
export const PROPOSABLE: readonly ActionId[] = [
  "finding.yes",
  "plan.approve_safe",
  "goal.start",
  // Spec step 133.
  "invest.rebalance",
  // Spec step 297: the practice portfolio's switch.
  "practice.pause",
  "practice.resume",
];

// Shopping a policy for the person: Jane gets the quotes now and, in demo advice, offers the
// switch with her pick (insurance/quotes.ts). The buttons it returns are the quote reply's.
export const RESHOP = "insurance.reshop";

// The score and its band, or, when it is low, words instead: "0, Building" would read as a
// verdict, so under the line Claude is told to say it plainly and kindly.
export function healthHeadline(score: number, band: string) {
  return score < HEALTH_SAY_IN_WORDS_BELOW
    ? {
        score: null,
        sayIt:
          "Their money health is under strain right now. Say that in words, not a number or a band, and name the one thing that would raise it most.",
      }
    : { score, band };
}

// Pages Claude may link to, by name.
export const CHAT_PAGES: Readonly<Record<string, { label: string; href: string }>> = {
  // Loans and debt (spec Phase Y, ./debt-tools.ts).
  ...DEBT_CHAT_PAGES,
  today: { label: "See today", href: "/home" },
  insurance: { label: "See your insurance", href: "/insurance" },
  plan: { label: "Open the plan", href: "/plan" },
  subscriptions: { label: "Open subscriptions", href: "/subscriptions" },
  bills: { label: "See bills", href: "/bills" },
  deadlines: { label: "See deadlines", href: "/deadlines" },
  insights: { label: "See insights", href: "/insights" },
  budgets: { label: "See budgets", href: "/budgets" },
  goals: { label: "See goals", href: "/goals" },
  afford: { label: "Can I afford this?", href: "/afford" },
  actions: { label: "See actions", href: "/actions" },
  net_worth: { label: "See net worth", href: "/net-worth" },
  investments: { label: "See what you own", href: "/investments" },
  settings: { label: "Settings", href: "/settings" },
  // Taxes (spec steps 118–127).
  taxes: { label: "See your taxes", href: "/taxes" },
  tax_profile: { label: "See my tax profile", href: "/taxes/profile" },
  tax_tags: { label: "See tax tags", href: "/taxes/tags" },
  tax_pack: { label: "Open the tax-time pack", href: "/tax-pack" },
};

const noInput = { type: "object" as const, properties: {}, additionalProperties: false };

export const CHAT_TOOLS: Anthropic.Tool[] = [
  ...FROM_ASK,
  // Loans and debt (spec Phase Y, ./debt-tools.ts).
  ...DEBT_TOOLS,
  // Insurance (spec Phase X).
  ...INSURANCE_TOOLS,
  {
    name: "safe_to_spend",
    description:
      "What the person can safely spend until their next payday (or the next few weeks), after upcoming bills, what's left in their budgets and what goes to their goals. The same number as the Today page.",
    input_schema: noInput,
  },
  {
    name: "coming_up",
    description:
      "Bills and deadlines coming up in the next month, soonest first, as on the Today page.",
    input_schema: noInput,
  },
  {
    name: "open_findings",
    description:
      "Things the app found that could save the person money and they haven't decided on yet (and what bank fees cost them in a year), with each one's id (for propose_action and finding_details), kind, estimate, and Jane's pick when there's one.",
    input_schema: noInput,
  },
  {
    name: "finding_details",
    description:
      "Everything about one finding, before you suggest what to do about it: why it was flagged, the evidence (charges and dates), what would change and what they'd give up, and, when the app compared options, what they pay now, Jane's pick and the runners-up with first-year cost and saving.",
    input_schema: {
      type: "object",
      properties: { finding_id: { type: "string", description: "An id from open_findings." } },
      required: ["finding_id"],
      additionalProperties: false,
    },
  },
  {
    name: "subscriptions",
    description:
      "Everything that charges the person on a schedule, from their transactions, as on the Subscriptions page: how often, the last charge and its date, the next expected date, the cost a year, whether it's a subscription, and the id of an open finding about it if there is one.",
    input_schema: noInput,
  },
  {
    name: "goals",
    description: "The person's savings goals: target, date, saved so far, and how they're going.",
    input_schema: noInput,
  },
  {
    name: "budgets",
    description: "This month's budgets: each category's budget, spent so far and what's left.",
    input_schema: noInput,
  },
  {
    name: "decision",
    description:
      'Jane\'s verdict and the numbers behind it for a money decision ("should I buy bitcoin / stocks / a house / a car", "should I invest", "should I pay off my card or invest", any paraphrase): card debt and its highest rate, cash and months of spending against the cushion, goals still short, and `verdict`, Jane\'s own answer in order of priority (high-rate debt, then the cushion, then goals, then the thing). Write the answer in your own words from the verdict and the numbers, plain and direct, opening with the verdict. Never predict what the thing will do. The crypto, investments or afford tools are only a follow-up.',
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: 'What they are thinking of, e.g. "bitcoin".' },
      },
      additionalProperties: false,
    },
  },
  {
    name: "net_worth",
    description:
      "What the person has (accounts and things they own) minus what they owe, from their linked balances.",
    input_schema: noInput,
  },
  {
    name: "recent_changes",
    description:
      "What changed lately in the person's money (spec step 97): bills or subscriptions whose price moved, new regular charges, paychecks late, smaller or from a new employer, categories running above their usual pace this month, and new fees. Each with what Jane is doing about it.",
    input_schema: noInput,
  },
  {
    name: "life_events",
    description:
      "Big life changes (spec step 100): moving, a new job or a new baby that Jane spotted from two or more signs in the person's money and hasn't asked about yet, and the life-event checklists they have going, with how far along each is.",
    input_schema: noInput,
  },
  {
    name: "plan_upkeep",
    description:
      "Plans that keep up (spec step 101): this month's budget tune-up (each budget, its amount and its usual month), transfers to savings Jane could count toward a goal, and the weekly review: what Jane did, what it saved and what's next.",
    input_schema: noInput,
  },
  {
    name: "proven_savings",
    description:
      "What Jane has saved the person (spec step 139): the confirmed total, each saving with the transaction that proves it (a refund that came back, a lower bill, a new plan's first bill, a cancelled charge that stopped), and apart from it what's still an estimate. Only the confirmed total counts as saved.",
    input_schema: noInput,
  },
  {
    name: "autopilot_settings",
    description:
      'How much Jane may do by herself in each area (spec step 141): subscriptions and bills, insurance, debt, taxes, investing, goals and budgets. Each area\'s level (always ask, the safe stuff, everything allowed), its caps each time and each month, and what it used this month. Over a cap Jane asks. To change an area, the person types it ("let Jane handle insurance up to $50 a month") or uses Settings.',
    input_schema: noInput,
  },
  {
    name: "nightly_log",
    description:
      "What Jane checked for the person last night (spec step 142): one line per area (bank sync, changes, insurance reshops, debts and rates, taxes, investing drift, goals and budgets), in the order she ran them, with what each found or did, and any that failed and will be tried again.",
    input_schema: noInput,
  },
  {
    name: "priorities",
    description:
      'The person\'s next best things to do (spec step 143), ranked across everything Jane found and is waiting on: findings, insurance picks, refinance offers, steps only they can do and dated deadlines. Each with the money it saves a year, the minutes it takes, its urgency and why it ranks where it does. Use it for "what should I do first" and to put the most important first.',
    input_schema: noInput,
  },
  {
    name: "my_profile",
    description:
      'What Jane knows about the person (spec step 253): income pattern and employer, household, home, car, debts, cover, accounts and life stage, each with where it came from (seen in their data, told by them, or a guess), how sure Jane is as a percentage with the reason, and whether they corrected it. Use it for "what do you know about me" and to check a fact before relying on it.',
    input_schema: noInput,
  },
  {
    name: "long_view",
    description:
      "Where the person's net worth could be in 10, 20 and 30 years (spec step 209), as a range from a low to a high return in today's dollars, from their balances, debts, home value and what they save; with every assumption (returns, inflation, home growth, what is invested each month). In demo advice mode it also gives what moves it most (more investing, or paying a debt faster) and whether retirement is on track; for real accounts give the projection and its assumptions only, with no advice. It is a range, never a promise.",
    input_schema: noInput,
  },
  {
    name: "what_if",
    description:
      "Runs a what-if through the person's own numbers (spec step 203): job loss, a raise, a baby, moving, buying a car or a home, going part-time. Returns month-by-month cash with and without it, the debt-free month, goals that slip, tax change, what to check on insurance, what's left for investing, and Jane's plan. Running it changes nothing; the person adopts the plan with a button. Give scenario and, if they said how long, months.",
    input_schema: {
      type: "object",
      properties: {
        scenario: { type: "string", enum: [...SCENARIOS] },
        months: { type: "number", description: "How many months it lasts, if said." },
      },
      required: ["scenario"],
      additionalProperties: false,
    },
  },
  {
    name: "monthly_report",
    description:
      "The person's newest monthly money report (spec step 148): for the month just ended, savings confirmed (that month and in all), what came in, payments toward cards and loans, transfers that went through (sample transfers), the money health score and its change, the next best thing, and the receipts that prove the savings. Each figure is the same as on the page it links to.",
    input_schema: noInput,
  },
  {
    name: "health_score",
    description:
      "The person's money health score (spec step 146): one number out of 100 and its band, made of weighted parts (cash cushion, room each month, bills on time, card balances, savings goals), each with its points, why and the step that would raise it; parts not counted yet; and the change since last month with the part that moved it most. Say it kindly: a low part is room to grow, never a judgement.",
    input_schema: noInput,
  },
  {
    name: "balance_forecast",
    description:
      'Where each checking account is heading over the next month (spec step 192): its balance today, the lowest point it is forecast to reach and the day, and the bills and deposits (paychecks on their pay schedule) that drive it. Use it for "why is my checking going negative", "will I run short before payday" and "what happens to my balance".',
    input_schema: noInput,
  },
  {
    name: "alerts",
    description:
      'The person\'s unread alerts (spec step 192): fees, big or odd charges, price rises, bills coming up and low balances, newest first, each with what it says. Use it for "any alerts for me" and "did anything weird happen".',
    input_schema: noInput,
  },
  {
    name: "household",
    description:
      'Whether the person shares their money with a partner (spec step 192): who is in the household, who has been invited and not yet joined. Never shows the other person\'s accounts. Use it for "can my wife see my accounts" and "add my husband".',
    input_schema: noInput,
  },
  {
    name: "calculate",
    description:
      'Arithmetic for a number you want that no tool gives directly: percent_of (percent of an amount, e.g. the 4% rule on a balance), per_year and per_month (a monthly amount over a year, a yearly amount over a month), difference (between two amounts), sum, and payoff_months (how long to pay off a balance at a monthly payment and an APR, with the interest it costs). Pass amounts in dollars exactly as they appear in the person\'s numbers or a tool result, and say in "basis" where they came from. The result is computed, so you may state it. Never use it with an amount you made up.',
    input_schema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["percent_of", "per_year", "per_month", "difference", "sum", "payoff_months"],
        },
        basis: {
          type: "string",
          description: 'Where the amounts came from, e.g. "retirement balance from holdings".',
        },
        percent: { type: "number" },
        amount: { type: "number", description: "Dollars." },
        other_amount: { type: "number", description: "Dollars (difference)." },
        amounts: { type: "array", items: { type: "number" }, description: "Dollars (sum)." },
        balance: { type: "number", description: "Dollars (payoff_months)." },
        monthly_payment: { type: "number", description: "Dollars (payoff_months)." },
        apr_percent: { type: "number", description: "Yearly rate in percent (payoff_months)." },
      },
      required: ["operation", "basis"],
      additionalProperties: false,
    },
  },
  {
    name: "whole_picture",
    description:
      'How the person is doing across every sector at once (spec step 183), for "am I OK?", "how am I doing" and "what should I do this month": a verdict (ok, watch or act) with its one-sentence headline, safe to spend until payday, bills and deadlines due this week and this month, budgets over, goals behind, urgent alerts, what Jane\'s agent is working on, the steps waiting on the person, and the one to three things that matter most (from the ranked list) with why. Lead with the headline, then the things that matter; use the same figures.',
    input_schema: noInput,
  },
  {
    name: "explain_figure",
    description:
      'How a headline figure was worked out (spec step 239): the rows it adds up, the biggest transactions behind it, the rules and rates from config and the date, for safe_to_spend, monthly_spending, monthly_income, net_worth, health_score or debt_free. Use it for "how did you get that?". If the person says a figure is wrong, point them to the page (/figures/<figure>) where a category or their income can be corrected; the correction sticks and updates everything that used it.',
    input_schema: {
      type: "object",
      properties: { figure: { type: "string", enum: [...FIGURE_IDS] } },
      required: ["figure"],
      additionalProperties: false,
    },
  },
  {
    name: "month_close",
    description:
      "The monthly close (spec step 244): the latest month Jane closed (on the first of the next), or the one waiting on charges she wasn't sure of: what came in and went out, the top categories, net worth at the close, plan against actual, what worked, whether the books added up, and whether a correction changed it since. A closed month's figures only change when the person corrects something in it.",
    input_schema: noInput,
  },
  {
    name: "books_check",
    description:
      "Whether the person's data adds up (spec step 238): what Jane checks every day (balances against transactions, the same account linked twice, a link that stopped updating or needs a sign-in, transfers between their own accounts) and the problems still open, in words. Figures that rely on a problem account are marked until it's fixed. Use it for \"are my numbers right?\" and before standing behind a figure from an account with a problem.",
    input_schema: noInput,
  },
  {
    name: "money_for_two",
    description:
      "Money for two (spec step 242), for a person in a household with a partner: how shared bills split (half each or by income, with the shares; never the partner's income), who owes whom, joint goals and their progress, the amount from which a move out of a shared account needs both partners' taps, and big moves waiting for a tap. Only what either of them shared; never the partner's own accounts. Null when they have no partner in Jane.",
    input_schema: noInput,
  },
  {
    name: "goal_tradeoffs",
    description:
      "Goals that trade off openly (spec step 241): whether the person's savings goals need more each month than the year plan has room for; if so each order's dates (when each goal is reached and how many months late), Jane's suggested order with the reason, and the order the person picked, if any. Use it for \"which goal first?\" and \"can I do both?\". The pick re-plans every sector only on the person's tap (the button under the answer).",
    input_schema: noInput,
  },
  {
    name: "steady_pay",
    description:
      "A steady paycheck from uneven income (spec step 240): whether the person has uneven (contracting, gig or freelance) income; if so this month's steady paycheck from the buffer (savings) to checking, why it is what it is (the buffer above or below its target, never under its floor), the buffer's target and floor, the tax share set aside from each deposit, and whether this month's has gone. Moves happen only by autopilot within its caps or the person's tap.",
    input_schema: noInput,
  },
  {
    name: "money_moves",
    description:
      "Money that moves itself (spec step 144): the newest paycheck's plan (what goes to each goal, the emergency fund, the tax set-aside and extra debt payments, kept above safe to spend's cushion) with what Jane moved by herself and what waits for a tap; cards and loans due in the next three weeks (spec step 145) with what pays each (the person's own autopay, a payment Jane scheduled, one she can schedule with a tap, or checking would run short and a due date worth moving after payday); and the latest transfers with their status. Until a money-movement partner is connected these are sample transfers: no real money moves.",
    input_schema: noInput,
  },
  {
    name: "propose_action",
    description:
      "Offer the person a button under your answer. You can't do anything yourself; the person decides by tapping. Use it at most once: when your answer suggests something that can be done, or the person asked for it. Actions: finding.yes (Yes and No on one open finding; give finding_id from open_findings), plan.approve_safe (approve the plan's safe items together), goal.start (start a savings goal; give goal_name, goal_amount in dollars and goal_month as YYYY-MM within the next 12 months), invest.rebalance (demo advice mode: place the orders that move to the recommended mix, in the simulated brokerage), practice.pause / practice.resume (demo advice mode: pause or resume Jane in the practice portfolio; give which: all, or opportunities for the small extra positions only), open (a link to a page; give page).",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...PROPOSABLE, "open", RESHOP] },
        policy_kind: {
          type: "string",
          enum: Object.keys(POLICY_KINDS),
          description:
            "For insurance.reshop: which policy to shop (car, home, renters, life, pet).",
        },
        finding_id: { type: "string" },
        which: {
          type: "string",
          enum: ["all", "opportunities"],
          description: "For practice.pause / practice.resume: all trading, or opportunities only.",
        },
        goal_name: { type: "string" },
        goal_amount: { type: "number" },
        goal_month: { type: "string" },
        page: { type: "string", enum: Object.keys(CHAT_PAGES) },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  // Spec step 94.
  {
    name: "show_block",
    description:
      "Show one chart, table or timeline under your answer, drawn from the person's own numbers (the same as the pages): spending_by_category (bars for one month; give month as YYYY-MM, or leave it out for this month), spending_by_month (bars, the last few months), coming_up (a timeline of bills and deadlines), goals (progress bars), options (a table comparing a finding's options; give finding_id). Use it at most once, when a picture says it better than a list.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: [...BLOCK_KINDS] },
        month: { type: "string" },
        finding_id: { type: "string" },
      },
      required: ["kind"],
      additionalProperties: false,
    },
  },
  // Spec step 295: backtests by risk level (demo advice).
  {
    name: "backtest_by_level",
    description:
      'How each risk level\'s model portfolio (Very low, Low, Medium, High, Very high) would have done, replayed over past prices from the same sample amount: for "how would a High portfolio have done in 2022" or "how bad did the drops get". Gives where the prices came from (real stored history, or the sample market\'s made-up prices with a planted crash and recovery), the end value, the worst drop with its dates and when it got back, the best and worst whole year, and with year that year\'s return and its worst fall; plus the assumptions (fund costs, rebalancing band, no taxes). Leave level out for all five. Demo advice mode only. Always call it a replay of past or sample history, never a forecast or what will happen.',
    input_schema: {
      type: "object",
      properties: {
        level: {
          type: "string",
          enum: Object.values(RISK_LEVELS).map((l) => l.label),
          description: "One risk level; leave out for all five.",
        },
        year: { type: "integer", description: "A calendar year, e.g. 2022." },
      },
      additionalProperties: false,
    },
  },
  // Taxes (spec steps 118–127): ./tax-tools.ts.
  ...TAX_TOOLS,
  // Spec step 128 on.
  ...INVESTMENT_TOOLS,
  // Spec step 293: the practice portfolio's news.
  ...NEWS_TOOLS,
  // Phase AW: the practice portfolio's settings, read and changed with a confirmation card.
  ...PRACTICE_TOOLS,
];

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

// A read-only tool. Ask's own tools run through runAskTool unchanged.
export async function runChatTool(
  userId: string,
  name: string,
  input: unknown,
  { client, now }: Options,
): Promise<ToolOutput> {
  if (FROM_ASK.some((t) => t.name === name))
    return runAskTool(userId, name, input, { client, now });
  if (isDebtTool(name)) return runDebtTool(userId, name, input, { client, now });
  if (isTaxTool(name)) return runTaxTool(userId, name, input, { client, now });
  if (isInvestmentTool(name)) return runInvestmentTool(userId, name, input, { client, now });
  if (isNewsTool(name)) return runNewsTool(userId, name, input, { client, now });
  if (isPracticeTool(name)) return runPracticeTool(userId, name, input, { client, now });
  if (isInsuranceTool(name)) return runInsuranceTool(userId, name, input, { client, now });
  const cents: number[] = [];
  const money = (value: number) => {
    cents.push(Math.abs(value));
    return value < 0 ? `-${formatCents(-value)}` : formatCents(value);
  };
  const out = (value: unknown): ToolOutput => ({ content: JSON.stringify(value), cents });
  const asOf = now.toISOString().slice(0, 10);

  switch (name) {
    case "calculate": {
      const result = calculate((input ?? {}) as CalcInput);
      if (!result.ok) return { content: JSON.stringify({ error: result.error }), cents: [] };
      const amounts = Object.fromEntries(
        Object.entries(result.cents).map(([key, value]) => [key, money(value)]),
      );
      return out({ ...amounts, ...result.numbers, note: result.note });
    }
    case "safe_to_spend": {
      const safe = (await homeSummary(userId, { client, now }))?.safeToSpend;
      if (!safe) return out({ note: "No checking account is linked, so there's no number." });
      return out({
        safeToSpend: money(safe.safeCents),
        until: safe.payday,
        checkingBalance: money(safe.balanceCents),
        upcomingBills: money(safe.billsCents),
        leftInBudgets: money(safe.budgetsLeftCents),
        forGoals: money(safe.goalsCents),
        setAsideForYearlyBills: money(safe.setAsideCents),
      });
    }
    case "coming_up": {
      const rows = (await homeSummary(userId, { client, now }))?.comingUp ?? [];
      return out({
        items: rows.map((r) => ({
          date: r.date,
          what: r.label,
          kind: r.href === "/bills" ? "bill" : "deadline",
          amount: r.amountCents === null ? null : money(r.amountCents),
        })),
      });
    }
    case "open_findings": {
      const snapshot = await loadSnapshotFast(userId, { client, now });
      const fees = await loadBankFees(userId, { client, now }).catch(() => null);
      return out({
        // The same figure as the brief's suggestion: fees in the last 12 months, scaled to a
        // year and said so when there are fewer months of data.
        bankFeesAYear: fees && {
          amount: money(fees.yearCents),
          fees: fees.count,
          estimate: fees.estimated,
          monthsOfData: fees.monthsOfData,
        },
        findings: (snapshot?.findings ?? []).map((f) => {
          if (f.annualSavingsCents !== null) money(f.annualSavingsCents);
          if (f.pick) money(f.pick.savingCents);
          return {
            id: f.findingId,
            kind: f.type,
            title: f.title,
            estimate: f.savings,
            janesPick: f.pick?.name ?? null,
          };
        }),
      });
    }
    case "finding_details": {
      const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
      const finding = await scopedFor(userId, client).findings.findFirst({
        where: { id: str(args.finding_id) },
        select: { ...CARD_SELECT, status: true },
      });
      if (!finding) return out({ error: "There's no finding with that id. Use open_findings." });
      const card = buildCard(finding);
      if (card.annualSavingsCents !== null) money(card.annualSavingsCents);
      const comparison = await comparisonFor(finding, { userId, client, now });
      const scored = (s: Scored) => ({
        provider: s.option.provider,
        plan: s.option.name,
        firstYearCost: money(s.firstYearCents),
        savingFirstYear: money(s.savingCents),
        notes: s.notes,
      });
      return out({
        id: card.findingId,
        kind: card.findingType,
        status: finding.status,
        title: card.title,
        why: card.explanation,
        whatChanges: card.whatChanges,
        estimateAYear: card.annualSavingsCents === null ? null : money(card.annualSavingsCents),
        giveUp: card.giveUp,
        alternatives: card.alternatives,
        evidence: card.evidence.map((row) => ({
          date: row.date,
          what: row.label,
          amount: row.amountCents === null ? null : money(row.amountCents),
        })),
        comparison: comparison && {
          payNowAYear: money(comparison.currentYearCents),
          janesPick: scored(comparison.pick),
          whyThePick: comparison.why,
          runnersUp: comparison.runnersUp.slice(0, CHAT_RUNNERS_UP).map(scored),
        },
      });
    }
    case "subscriptions": {
      const { charges } = await loadRecurring(userId, { client, now });
      return out({
        charges: charges.map((r) => ({
          merchant: r.merchant,
          subscription: r.subscription,
          billed: frequencyWords(r.frequency),
          lastCharge: money(r.lastAmountCents),
          lastDate: r.lastDate,
          nextDate: r.nextDate,
          aYear: money(r.annualCostCents),
          openFindingId: r.openFindingId,
        })),
      });
    }
    case "recent_changes": {
      const changes = await loadChanges(userId, { client, now });
      return out({
        changes: changes.map((c) => ({
          what: c.kind,
          said: c.title,
          date: c.date,
          amount: money(c.amountCents),
          usual: c.usualCents === null ? null : money(c.usualCents),
          merchant: c.merchant,
          category: c.category,
          jane: c.finding?.handledBy
            ? `already acting on it (${c.finding.handledBy === "rule" ? "autopilot" : "they said yes"})`
            : c.finding
              ? `can act on it with finding ${c.finding.id}`
              : null,
          openFindingId:
            c.finding && (c.finding.status === "new" || c.finding.status === "shown")
              ? c.finding.id
              : null,
        })),
      });
    }
    case "life_events": {
      const [guesses, checklists] = await Promise.all([
        lifeGuessesFor(userId, { client, now }),
        listLifeEvents(userId, { client }),
      ]);
      return out({
        spotted: guesses.map(guessLine),
        checklists: checklists.map((c) => ({
          kind: c.kind,
          started: c.startedOn,
          done: c.completedAt !== null,
          ticked: `${c.checkedItems.length} of ${LIFE_EVENTS[c.kind].items.length}`,
        })),
      });
    }
    case "plan_upkeep": {
      const [upkeep, snapshot] = await Promise.all([
        loadUpkeep(userId, { client, now }),
        loadSnapshotFast(userId, { client, now }),
      ]);
      return out({
        tuneUp: upkeep.tuneUp && {
          month: upkeep.tuneUp.month,
          status: upkeep.tuneUp.status,
          budgets: upkeep.tuneUp.changes.map((c) => ({
            category: c.category,
            now: money(c.fromCents),
            usual: money(c.toCents),
          })),
        },
        transfersToCount: upkeep.transfers.map((t) => ({
          amount: money(t.amountCents),
          date: t.date,
          goal: t.goal.name,
        })),
        weeklyReview: snapshot ? weeklyReview(snapshot, now).body : null,
      });
    }
    case "proven_savings": {
      const saved = await provenSavings(userId, { client, now });
      return out({
        confirmedTotal: money(saved.confirmedCents),
        receipts: saved.confirmed.map((r) => ({
          what: r.title,
          kind: r.kind,
          saved: money(r.cents),
          perYear: r.yearly,
          proof: r.proof,
        })),
        estimatedTotal: money(saved.estimatedCents),
        estimates: saved.estimated.map((e) => ({
          what: e.title,
          about: money(e.cents),
          why: e.why,
        })),
      });
    }
    case "my_profile": {
      const profile = await loadProfile(userId, { client, now });
      return out({
        months: profile.months,
        facts: Object.values(profile.facts).map((f) => ({
          fact: f.label,
          value: sayFact(f.key, f.value),
          source: f.source,
          sureness: `${f.confidence}%`,
          because: f.evidence,
        })),
      });
    }
    case "long_view": {
      const view = await loadLongView(userId, {}, { client, now });
      if (!view) return out({ view: null, why: "No accounts linked yet." });
      return out({
        inTodaysDollars: true,
        range: view.horizons.map((h) => ({
          years: h.years,
          low: money(h.lowCents),
          high: money(h.highCents),
          owing: money(h.parts.debtsCents),
        })),
        assumptions: view.assumptions.map((a) => ({
          what: a.label,
          value: a.value,
          source: a.source,
        })),
        ...(view.advice
          ? {
              demoAdviceLabelRequired: true,
              whatMovesItMost: view.levers.map((l) => ({
                what: l.words,
                adds30YearLow: money(l.deltaCents),
              })),
              retirement: view.retirement && {
                low: money(view.retirement.projection.lowCents),
                high: money(view.retirement.projection.highCents),
                status: view.retirement.status,
              },
            }
          : {}),
      });
    }
    case "what_if": {
      const scenario = (input as { scenario?: unknown }).scenario;
      if (!isScenario(scenario)) return out({ error: "Unknown scenario." });
      const months = (input as { months?: unknown }).months;
      const run = await whatIf(
        userId,
        scenario,
        { months: typeof months === "number" ? months : undefined },
        { client, now },
      );
      if (!run) return out({ run: null, why: "No accounts linked yet." });
      return out({
        scenario: run.label,
        lowestWith: money(run.after.lowestCents),
        lowestWithout: money(run.before.lowestCents),
        cashRunsOutInMonth: run.after.runsOutMonth,
        forecast: run.sectors.forecast,
        debt: run.sectors.debt,
        goals: run.sectors.goals.map((g) => ({ goal: g.name, status: g.status, note: g.note })),
        taxes: run.sectors.taxes,
        investing: run.sectors.investing,
        toCheck: run.sectors.insurance,
        plan: run.plan.map((c) => c.title),
        changedAnything: false,
      });
    }
    case "monthly_report": {
      const stored = await storedReport(userId, null, { client });
      if (!stored)
        return out({ report: null, why: "The first report comes at the start of next month." });
      const r = stored.report;
      return out({
        month: r.month,
        saved: { thisMonth: money(r.saved.monthCents), inAll: money(r.saved.totalCents) },
        earned: money(r.earnedCents),
        paidDown: money(r.paidDownCents),
        moved: { amount: money(r.moved.cents), transfers: r.moved.count, sampleOnly: true },
        health: r.health,
        next: r.next?.title ?? null,
        receipts: r.receipts.map((x) => ({
          what: x.title,
          amount: money(x.cents),
          yearly: x.yearly,
          proof: x.proof,
        })),
      });
    }
    case "health_score": {
      const view = await healthFor(userId, { client, now });
      return out(
        view
          ? {
              ...healthHeadline(view.score, view.band),
              parts: view.parts.map((p) => ({
                part: p.label,
                points: p.points,
                outOf: p.max,
                why: p.why,
                toRaiseIt: p.next,
              })),
              notCounted: view.left.map((l) => ({ part: l.label, why: l.why })),
              lastMonth: view.before && {
                month: view.before.month,
                score: view.before.score,
                change: view.change?.delta ?? 0,
                mostlyFrom: view.change?.biggest?.label ?? null,
              },
            }
          : { score: null, why: "No accounts linked yet." },
      );
    }
    case "explain_figure": {
      const figure = (input as { figure?: unknown }).figure;
      if (typeof figure !== "string" || !(FIGURE_IDS as readonly string[]).includes(figure)) {
        return out({ error: "Unknown figure." });
      }
      const working = await explainFigure(userId, figure as FigureId, { client, now });
      if (!working) return out({ working: null, why: "No accounts linked yet." });
      return out({
        figure: working.title,
        value: working.value,
        asOf: working.asOf,
        how: working.summary,
        rows: working.rows,
        transactions: working.transactions.map((t) => ({
          date: t.date,
          what: t.description,
          amount: money(t.amountCents),
          category: t.category_label,
        })),
        rulesUsed: working.rules,
        canBeCorrected: working.corrections,
        page: `/figures/${working.id}`,
      });
    }
    case "month_close": {
      const view = await loadClose(userId, { client });
      if (!view) return out({ view: null, why: "No month closed yet." });
      const f = view.figures;
      return out({
        month: view.month,
        status: view.status,
        cameIn: money(f.incomeCents),
        wentOut: money(f.spendingCents),
        topCategories: f.topCategories.map((c) => ({
          category: c.category,
          amount: money(c.cents),
        })),
        netWorthAtClose: f.netWorthCents === null ? null : money(f.netWorthCents),
        booksProblems: f.booksOpen,
        plan: f.plan,
        worked: f.worked,
        waitingOn: view.uncertain.map((t) => ({
          what: t.description,
          on: t.date,
          amount: money(t.amountCents),
        })),
        correctedSinceClose: view.correctedAt !== null,
      });
    }
    case "books_check": {
      const books = await openBooks(userId, { client });
      return out({
        allAddUp: books.open.filter((o) => o.kind !== "transfer").length === 0,
        problems: books.open.map((o) => ({ what: o.label, detail: o.words })),
        accountsWithMarkedFigures: books.markedAccountIds.length,
      });
    }
    case "money_for_two": {
      const view = await loadMoneyForTwo(userId, { client, now });
      if (!view) return out({ view: null, why: "No partner in their household yet." });
      return out({
        partner: view.partnerName,
        split: view.rule,
        chosen: view.chosen,
        yourShare: `${Math.round(view.myShareBps / 100)}%`,
        yourShareByIncome: `${Math.round(view.incomeMyShareBps / 100)}%`,
        owedToYou: money(view.owedToMeCents),
        spentTogetherThisMonth: money(view.sharedSpentCents),
        bothTapsFrom: money(view.bigMoveCents),
        jointGoals: view.jointGoals.map((g) => ({
          name: g.name,
          saved: money(g.savedCents),
          target: money(g.targetCents),
          by: g.targetDate,
        })),
        bigMovesWaiting: view.bigMoves.map((m) => ({
          amount: money(m.amountCents),
          to: m.toName,
          on: m.runOn,
          waitingFor: m.mine ? "your partner" : "you",
        })),
      });
    }
    case "goal_tradeoffs": {
      const view = await loadTradeoffs(userId, { client, now });
      if (!view) return out({ view: null, why: "No accounts linked yet." });
      const dates = (o: TradeOrder) =>
        o.dates.map((d) => ({
          goal: d.name,
          reached: d.month,
          wanted: d.wantedMonth,
          monthsLate: d.lateMonths,
        }));
      return out({
        competing: view.competing,
        options: view.options
          .slice(0, 4)
          .map((o) => ({ first: o.dates[0]?.name, dates: dates(o) })),
        suggested: view.suggested ? dates(view.suggested) : null,
        why: view.reason || null,
        picked: view.chosen !== null,
        nowInForce: view.current ? dates(view.current) : null,
      });
    }
    case "steady_pay": {
      const view = await loadSteady(userId, { client, now });
      if (!view) return out({ view: null, why: "No accounts linked yet." });
      return out({
        unevenIncome: view.uneven,
        steadyPaycheck:
          view.plan && view.plan.status !== "not_enough_history"
            ? money(view.plan.paycheckCents)
            : null,
        why: view.plan?.reason ?? null,
        buffer: money(view.bufferCents),
        bufferTarget: view.plan ? money(view.plan.targetCents) : null,
        bufferFloor: view.plan ? money(view.plan.floorCents) : null,
        taxSetAsideRate: view.setAsideRate,
        thisMonthSent: view.sent && {
          amount: money(view.sent.amountCents),
          on: view.sent.runOn,
          by: view.sent.by,
        },
      });
    }
    case "money_moves": {
      const [plan, transfers, partner] = await Promise.all([
        latestPaycheckPlan(userId, { client, now }),
        listTransfers(userId, { client, now }),
        moneyPartnerFor(userId, { client }),
      ]);
      const bills = partner ? await loadBillPay(userId, { client, now }) : null;
      return out({
        sampleOnly: true,
        bills: (bills?.items ?? []).map((i) => ({
          name: i.bill.name,
          due: i.bill.dueOn,
          minimum: money(i.bill.minimumCents),
          status: i.status,
          ...(i.status === "scheduled" || i.status === "ask"
            ? { amount: money(i.amountCents), on: i.runOn }
            : {}),
          ...(i.status === "short" && i.moveTo ? { moveDueDateTo: i.moveTo } : {}),
        })),
        paycheck: plan && {
          amount: money(plan.paycheckCents),
          paidOn: plan.paidOn,
          moves: plan.moves.map((m) => ({ to: m.label, amount: money(m.cents), status: m.status })),
        },
        transfers: transfers.slice(0, 10).map((t) => ({
          to: t.toName,
          amount: money(t.amountCents),
          status: t.status,
          on: t.runOn,
          by: t.by,
        })),
      });
    }
    case "priorities": {
      const snapshot = await loadSnapshotFast(userId, { client, now });
      return out({
        ranked: (snapshot ? rankedFor(snapshot) : []).slice(0, 10).map((r) => ({
          what: r.title,
          kind: r.kind,
          savesAYear: r.valueCents === null ? null : money(r.valueCents),
          minutes: r.minutes,
          due: r.dueOn ?? null,
          why: r.why,
          findingId: r.kind === "finding" ? r.ref : null,
        })),
      });
    }
    case "balance_forecast": {
      const input = await loadDetectionInput(userId, { client, now });
      const forecasts = forecastAccounts(input, FORECAST_DAYS);
      if (forecasts.length === 0) {
        return out({ note: "No checking account is linked, so there's no forecast." });
      }
      return out({
        accounts: forecasts.map((f) => ({
          account: f.accountName,
          balanceToday: money(f.startCents),
          lowestPoint: money(f.lowest.balanceCents),
          lowestOn: f.lowest.date,
          goesNegative: f.lowest.balanceCents < 0,
          billsBeforeThen: f.bills
            .filter((b) => b.date <= f.lowest.date)
            .map((b) => ({ what: b.merchant, on: b.date, amount: money(b.amountCents) })),
          depositsBeforeThen: f.income
            .filter((i) => i.date <= f.lowest.date)
            .map((i) => ({ from: i.merchant, on: i.date, amount: money(i.amountCents) })),
        })),
      });
    }
    case "alerts": {
      const alerts = await newestUnreadAlerts(userId, { client, limit: 10 });
      return out({
        unread: alerts.map((a) => ({
          title: a.title,
          what: a.body,
          on: a.createdAt.toISOString().slice(0, 10),
        })),
      });
    }
    case "household": {
      const household = await householdOf(userId, { client });
      if (!household) return out({ note: "They aren't sharing with a partner." });
      return out({
        members: household.members.length,
        waitingToJoin: household.invites.map((i) => ({ email: i.email })),
      });
    }
    case "whole_picture": {
      const snapshot = await loadSnapshotFast(userId, { client, now });
      if (!snapshot) return out({ linked: false });
      const ranked = rankedFor(snapshot);
      const week = wholePicture(snapshot, ranked, "now");
      const month = wholePicture(snapshot, ranked, "month");
      const due = (rows: typeof week.due) =>
        rows.map((d) => ({
          what: d.label,
          date: d.date,
          amount: d.amountCents === null ? null : money(d.amountCents),
        }));
      return out({
        verdict: week.verdict,
        headline: week.headline,
        safeToSpend: week.safe && {
          amount: money(week.safe.safeCents),
          untilPayday: week.safe.payday,
        },
        dueThisWeek: due(week.due),
        dueThisMonth: due(month.due),
        budgetsOver: week.budgetsOver.map((b) => ({
          category: b.category,
          over: money(b.overCents),
        })),
        goalsBehind: week.goalsBehind.map((g) => ({ goal: g.name, stillToGo: money(g.leftCents) })),
        urgent: week.urgent,
        healthScore: week.health && {
          ...healthHeadline(week.health.score, week.health.band),
          whatWouldHelpMost: week.health.next,
        },
        janeWorkingOn: week.working,
        waitingOnThePerson: week.waitingOnYou,
        safeToApproveAtOnce: week.safeItems,
        mattersMost: week.top.map((r) => ({
          what: r.title,
          savesAYear: r.valueCents === null ? null : money(r.valueCents),
          why: r.why,
          findingId: r.kind === "finding" ? r.ref : null,
        })),
      });
    }
    case "nightly_log": {
      const run = await lastControllerRun(userId, { client, now });
      return out(
        run
          ? {
              night: run.day,
              checked: run.steps.map((s) => ({
                area: CONTROLLER_STEP_LABELS[s.step],
                result: s.status,
                did: s.did,
                changed: s.changed,
              })),
            }
          : { note: "No nightly run yet." },
      );
    }
    case "autopilot_settings": {
      const sectors = await sectorAutopilots(userId, { client, now });
      return out({
        areas: sectors.map((s) => ({
          area: SECTOR_LABELS[s.sector],
          level: SECTOR_LEVEL_LABELS[s.level],
          eachTime: money(s.actionCapCents),
          eachMonth: money(s.monthlyCapCents),
          usedThisMonth: money(s.usedThisMonthCents),
          setBy: s.source === "set" ? "the person" : "their autopilot level's default",
        })),
      });
    }
    case "goals": {
      const goals = await listGoals(userId, { client, now });
      return out({
        goals: goals.map((g) => ({
          name: g.name,
          target: money(g.targetCents),
          by: g.targetDate,
          saved: money(g.progress.savedCents),
          status: g.progress.status,
          monthlyNeeded: g.progress.status === "on_the_way" ? money(g.progress.monthlyCents) : null,
        })),
      });
    }
    case "budgets": {
      const db = scopedFor(userId, client);
      const budgets = await db.budgets.findMany({ select: { category: true, amountCents: true } });
      if (budgets.length === 0) return out({ budgets: [], note: "No budgets set." });
      const summary = budgetSummary(
        await loadInsightTransactions(db, asOf, BUDGET_SUGGESTION_MONTHS + 1),
        budgets,
        asOf,
      );
      return out({
        month: summary.month,
        daysLeft: summary.daysLeft,
        budgets: summary.progress.map((p) => ({
          category: p.category,
          budget: money(p.budgetCents),
          spent: money(p.spentCents),
          left: money(p.leftCents),
          over: p.over,
        })),
      });
    }
    case "decision": {
      const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
      const subject = str(args.subject).slice(0, 80);
      const [f, advice] = await Promise.all([
        loadDecisionFacts(userId, { client, now }),
        adviceMode(userId, { client }),
      ]);
      const asked = subject ? parseDecision(`should i buy ${subject.toLowerCase()}`) : null;
      const verdict = decisionReply(
        { kind: "decision", item: asked?.item ?? "other", label: subject || null },
        null,
        f,
        advice,
      ).body;
      cents.push(...dollarFigures(verdict).map((x) => x.cents));
      return out({
        verdict,
        cardDebt: money(f.cardDebtCents),
        ...(f.topRateBps ? { highestRatePercent: f.topRateBps / 100 } : {}),
        cash: money(f.cashCents),
        monthlySpending: money(f.monthlySpendCents),
        ...(f.cushionTargetCents !== null ? { cushionTarget: money(f.cushionTargetCents) } : {}),
        ...(f.cushionMonths !== null ? { monthsOfSpendingInCash: f.cushionMonths } : {}),
        goalsStillShort: f.goalsBehind.map((g) => ({ name: g.name, toGo: money(g.leftCents) })),
      });
    }
    case "net_worth": {
      const db = scopedFor(userId, client);
      const [accounts, owned, crypto] = await Promise.all([
        db.accounts.findMany({
          select: { id: true, name: true, type: true, subtype: true, currentBalanceCents: true },
        }),
        db.ownedAssets.findMany({ select: { id: true, valueCents: true, valuedOn: true } }),
        cryptoTotal(userId, { client }),
      ]);
      const worth = netWorth(
        accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })),
        owned.map((o) => ({ ...o, valuedOn: o.valuedOn.toISOString().slice(0, 10) })),
        crypto,
      );
      return out({
        has: money(worth.assetsCents),
        owes: money(worth.debtsCents),
        netWorth: money(worth.netCents),
        ...(worth.cryptoCents > 0 ? { ofWhichCryptoReadOnly: money(worth.cryptoCents) } : {}),
        accountsWithoutABalance: worth.missing.length,
      });
    }
    case "backtest_by_level": {
      const data = await backtestsFor(userId, { client, now });
      if (!data.advice)
        return out({
          note: "Backtests of the model portfolios are demo advice, for the demo bank's sample people only. For real accounts, say Jane can't show them yet.",
        });
      const b = data.backtests;
      const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
      const asked = str(args.level).toLowerCase().replace(/_/g, " ");
      const year = Number.isInteger(args.year) ? (args.year as number) : null;
      const levels = b.levels.filter((l) => !asked || l.label.toLowerCase() === asked);
      if (levels.length === 0) return out({ error: `There's no risk level called ${asked}.` });
      return out({
        replay: b.label,
        to: b.to,
        prices: b.note,
        notAForecast: b.notAForecast,
        assumptions: {
          startingAmount: money(b.assumptions.startCents),
          yearlyFundCostPercent: Object.fromEntries(
            Object.entries(b.assumptions.feeBps).map(([k, v]) => [k, v / 100]),
          ),
          rebalanceWhenAPartDriftsByPoints: b.assumptions.rebalanceBandPoints,
          tradingCosts:
            b.assumptions.tradeCostBps === 0 ? "none" : `${b.assumptions.tradeCostBps / 100}%`,
          taxes: "none (base case)",
          moneyAddedOrTaken: "none",
        },
        levels: levels.map((l) => {
          const r = l.result;
          const y = year === null ? null : r.years.find((x) => x.year === year);
          return {
            level: l.label,
            stocksPercent: Math.round((l.weights.us_stocks + l.weights.intl_stocks) * 100),
            bondsPercent: Math.round(l.weights.bonds * 100),
            cashPercent: Math.round(l.weights.cash * 100),
            yearlyFundCostPercent: Math.round(l.yearlyFeeBps) / 100,
            endValue: money(r.endCents),
            overall: formatReturn(r.totalReturn),
            worstDrop: {
              fall: formatReturn(r.worstDrop.fraction),
              from: money(r.worstDrop.peakCents),
              to: money(r.worstDrop.troughCents),
              peakOn: longDate(r.worstDrop.peakDate),
              lowOn: longDate(r.worstDrop.troughDate),
              backBy: r.worstDrop.recoveredOn ? longDate(r.worstDrop.recoveredOn) : "not back yet",
            },
            bestYear: r.bestYear && {
              year: r.bestYear.year,
              return: formatReturn(r.bestYear.return),
            },
            worstYear: r.worstYear && {
              year: r.worstYear.year,
              return: formatReturn(r.worstYear.return),
            },
            ...(year === null
              ? {}
              : y
                ? {
                    inYear: {
                      year,
                      startValue: money(y.startCents),
                      endValue: money(y.endCents),
                      return: formatReturn(y.return),
                      worstFallInTheYear: formatReturn(y.worstDrop),
                      ...(y.whole ? {} : { partYear: `${longDate(y.from)} to ${longDate(y.to)}` }),
                    },
                  }
                : { inYear: { year, note: "That year isn't in the replay." } }),
          };
        }),
      });
    }
    default:
      return { content: JSON.stringify({ error: `There's no tool called ${name}.` }), cents: [] };
  }
}

// The person's main numbers, looked up before Claude is asked and sent with the question,
// so most answers need no lookup. The same tools Claude can call, so the figures are
// recorded for the guardrails in the same way. One that fails is left out.
// Worked out afresh: every sector's lookup. Slow on a slow database, so the chat doesn't do it
// while someone waits (see chatPrimer); it is done after each sync, scan and correction.
async function computePrimer(
  userId: string,
  { client, now }: Options,
): Promise<{ text: string; cents: number[] }> {
  const results = await Promise.allSettled(
    CHAT_PRIMER_TOOLS.map((name) => runChatTool(userId, name, {}, { client, now })),
  );
  const parts: string[] = [];
  const cents: number[] = [];
  results.forEach((result, i) => {
    if (result.status !== "fulfilled") return;
    parts.push(`${CHAT_PRIMER_TOOLS[i]}: ${result.value.content}`);
    cents.push(...result.value.cents);
  });
  // What matters most and the open findings, from the saved snapshot (one query): so the usual
  // "what should I do first" needs no lookup by Claude.
  const matters = await loadSnapshotFast(userId, { client, now })
    .then(mattersBlock)
    .catch(() => ({ text: "", cents: [] as number[] }));
  if (matters.text) {
    parts.push(matters.text);
    cents.push(...matters.cents);
  }
  // Who they are: the facts of their life (renter or owner, family, how they are paid, company
  // stock, a 401(k) and so on), so an answer fits their life instead of anyone's.
  const profile = await loadProfile(userId, { client, now }).catch(() => null);
  if (profile) {
    const about = FACT_KEYS.flatMap((key) => {
      const fact = profile.facts[key];
      if (!fact || fact.value === null || fact.value === "unknown" || fact.confidence < 60)
        return [];
      if (typeof fact.value === "number" && /_cents$/.test(key)) cents.push(Math.abs(fact.value));
      return [`${fact.label}: ${sayFact(key, fact.value)}`];
    });
    if (about.length > 0) parts.push(`about_them: ${JSON.stringify(about)}`);
  }
  // Spec step 91: what they told Jane, and suggestions not to make again.
  const remembered = await listPreferences(userId, { client }).catch(() => []);
  if (remembered.length > 0) {
    parts.push(`remembered: ${JSON.stringify(remembered.map((p) => p.label))}`);
  }
  return { text: parts.join("\n"), cents };
}

// Works the numbers out and saves them for the chat to read. Run after a sync, a scan or a
// correction (through a dynamic import, as this file reaches those by other routes).
export async function refreshPrimer(userId: string, options: Options): Promise<void> {
  // And the snapshot the agenda and the tools read, saved the same way.
  await refreshSnapshot(userId, options).catch((error) =>
    console.error("Saving the snapshot failed", { error: String(error) }),
  );
  const primer = await computePrimer(userId, options);
  keepPrimer(userId, options.now, primer);
  await writeStoredPrimer(userId, primer, options);
}

// Spec step 93: reused for a minute in memory, and saved in the database: one query for the
// chat to read instead of every sector's lookup. A saved copy that is old is still used at
// once and refreshed behind it; with none yet, they are worked out here, once.
const refreshing = new Set<string>();
export async function chatPrimer(
  userId: string,
  { client, now }: Options,
): Promise<{ text: string; cents: number[] }> {
  const cached = cachedPrimer(userId, now);
  if (cached) return cached;
  const stored = await readStoredPrimer(userId, { client });
  if (stored && stored.primer.text !== "") {
    keepPrimer(userId, now, stored.primer);
    if (isStale(stored.at, now) && !refreshing.has(userId)) {
      refreshing.add(userId);
      void refreshPrimer(userId, { client, now })
        .catch((error) => console.error("Refreshing the numbers failed", { error: String(error) }))
        .finally(() => refreshing.delete(userId));
    }
    return stored.primer;
  }
  const primer = await computePrimer(userId, { client, now });
  keepPrimer(userId, now, primer);
  await writeStoredPrimer(userId, primer, { client, now });
  return primer;
}

// What propose_action adds to the reply: the buttons, the refs they need, and a fixed
// line saying what they're for. Or why it was refused.
export type Proposal =
  | { ok: true; actions: MessageAction[]; refs: Reply["refs"]; line: string | null }
  | { ok: false; error: string };

const refuse = (error: string): Proposal => ({ ok: false, error });

export async function proposeAction(
  userId: string,
  input: unknown,
  { client, now }: Options,
): Promise<Proposal> {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const action = str(args.action);

  if (action === "open") {
    const page = Object.hasOwn(CHAT_PAGES, str(args.page)) ? CHAT_PAGES[str(args.page)] : null;
    if (!page) return refuse("Unknown page.");
    return { ok: true, actions: [{ id: "open", kind: "link", ...page }], refs: {}, line: null };
  }
  if (action === RESHOP) {
    const kind = str(args.policy_kind);
    const policyKind = Object.hasOwn(POLICY_KINDS, kind) ? (kind as PolicyKind) : null;
    const reply = await quotesAnswer(
      userId,
      { kind: "insurance", ask: "quotes", policyKind },
      { client, now },
    );
    const acts = reply.actions.filter((a) => a.kind !== "link");
    if (acts.length === 0) {
      // No quote to switch to (none on file, or which one?): what it found, for Claude to say.
      return refuse(reply.body);
    }
    return { ok: true, actions: reply.actions, refs: reply.refs, line: reply.body };
  }
  // Only buttons from the registry, and only the ones Claude may offer.
  const id = action as ActionId;
  if (
    !(ACTION_IDS as readonly string[]).includes(action) ||
    !Object.hasOwn(ACTION_HANDLERS, action) ||
    !PROPOSABLE.includes(id)
  ) {
    return refuse(`"${action}" isn't an action you can offer.`);
  }

  if (id === "finding.yes") {
    const snapshot = await loadSnapshotFast(userId, { client, now });
    const finding = snapshot?.findings.find((f) => f.findingId === str(args.finding_id));
    if (!snapshot || !finding) return refuse("That isn't one of the person's open findings.");
    const candidate = findingCandidate(finding);
    return { ok: true, actions: candidate.actions, refs: candidate.refs, line: candidate.body };
  }

  if (id === "plan.approve_safe") {
    const snapshot = await loadSnapshotFast(userId, { client, now });
    if (!snapshot || snapshot.plan.safeItems === 0) {
      return refuse("Nothing on the plan is safe to approve together right now.");
    }
    return {
      ok: true,
      actions: [
        { id, label: "Approve all safe ones", kind: "primary" },
        { id: "open", label: "Review the plan", kind: "link", href: "/plan" },
      ],
      refs: {},
      line: null,
    };
  }

  if (id === "invest.rebalance") {
    const { advice, plan } = await loadRebalance(userId, { client, now });
    if (!advice || !plan || plan.orders.length === 0) {
      return refuse(
        "There's no rebalancing to offer: not demo advice mode, no profile, or on target.",
      );
    }
    const reply = rebalanceOffer(plan);
    return { ok: true, actions: reply.actions, refs: reply.refs, line: reply.body };
  }

  if (id === "practice.pause" || id === "practice.resume") {
    if (!(await adviceMode(userId, { client }))) return refuse(PRACTICE_ONLY_NOTE);
    const view = await loadPractice(userId, { client, now });
    if (!view) return refuse("There's no practice portfolio to pause or resume.");
    const which = str(args.which) === "opportunities" ? "opportunities" : "all";
    const pausing = id === "practice.pause";
    const already = which === "all" ? view.paused : view.opportunitiesPaused;
    const what = which === "all" ? "the practice portfolio" : "opportunities";
    if (already === pausing) {
      return refuse(
        `${what[0].toUpperCase()}${what.slice(1)} is already ${pausing ? "paused" : "running"}.`,
      );
    }
    return {
      ok: true,
      actions: [
        {
          id,
          label: `${pausing ? "Pause" : "Resume"} ${which === "all" ? "Jane" : "opportunities"}`,
          kind: "primary",
        },
      ],
      refs: { advice: true, practiceWhich: which },
      line: null,
    };
  }

  // goal.start
  const name = str(args.goal_name).slice(0, 80);
  const amount = typeof args.goal_amount === "number" ? args.goal_amount : NaN;
  const targetCents = Math.round(amount * 100);
  const month = str(args.goal_month);
  const asOf = now.toISOString().slice(0, 10);
  if (!name) return refuse("The goal needs a name.");
  if (!Number.isFinite(amount) || targetCents <= 0 || targetCents > MAX_AFFORD_CENTS) {
    return refuse("The goal needs an amount in dollars.");
  }
  if (!affordWindow(asOf).months.slice(1).includes(month)) {
    return refuse("The goal month must be YYYY-MM within the next 12 months, after this one.");
  }
  return {
    ok: true,
    actions: [{ id, label: "Start a goal for it", kind: "primary" }],
    refs: { goal: { name, targetCents, targetDate: `${month}-01` } },
    line: `The goal: ${name}, ${formatCents(targetCents)} by ${monthLabel(month)}.`,
  };
}
