import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@/generated/prisma/client";
import { formatBps } from "@/insights/investments";
import type { ToolOutput } from "@/lib/ask/tools";
import { GOALS, HORIZONS, RISK_LEVELS, type RiskLevel } from "@/config/investing";
import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { adviceMode } from "@/lib/advice-mode";
import { loadFees } from "@/lib/investments/fees";
import { loadInvestments } from "@/lib/investments/holdings";
import { EXPLAINERS, REVIEW_NOTE, explainer } from "@/config/learn";
import { autopilotOf } from "@/lib/autopilot";
import { autopilotFor } from "@/lib/sector-autopilot";
import { loadInvestmentSnapshot } from "./snapshot";
import { investmentsByHerself, overviewReply } from "./replies";
import { loadAccountPlan } from "@/lib/investments/accounts";
import { loadReturns } from "@/lib/investments/returns";
import { loadGoalBuckets } from "@/lib/investments/goal-buckets";
import { estimateCollege, loadCollege, type CollegeEstimate } from "@/lib/investments/college";
import { loadHsa } from "@/lib/investments/hsa";
import { loadCompanyStock } from "@/lib/investments/company-stock";
import { loadCrypto } from "@/lib/crypto/crypto";
import { loadCash } from "@/lib/investments/cash";
import { loadRetirementAccounts } from "@/lib/investments/retirement-accounts";
import { loadOldAccounts } from "@/lib/investments/old-accounts";
import { loadRetirementIncome } from "@/lib/investments/retirement-income";
import { loadFamily } from "@/lib/investments/family";
import { loadProperty } from "@/lib/investments/property";
import { loadCostlyProducts } from "@/lib/investments/costly-products";
import { reviewFor } from "./review-copy";
import { loadLocation } from "@/lib/investments/location";
import { loadPlanMenu } from "@/lib/investments/plan-menu";
import { loadHonest } from "@/lib/investments/honest";
import { loadShortTerm } from "@/lib/investments/short-term";
import { loadFamilyFile } from "@/lib/investments/family-file";
import { loadValues } from "@/lib/investments/values";
import { loadSuddenMoney } from "@/lib/investments/sudden-money";
import { loadSteadyHand } from "@/lib/investments/steady-hand";
import { CASH_HOMES, CASH_RATES_AS_OF } from "@/config/cash";
import { formatReturn } from "@/insights/returns";
import { loadAutoInvest } from "@/lib/investments/auto-invest";
import { loadRebalance } from "@/lib/investments/rebalance";
import { loadRetirement } from "@/lib/investments/retirement";
import { loadReview } from "@/lib/investments/review";
import { profileOf } from "@/lib/investments/profile";
import { profileSummary } from "@/planning/investor-profile";
import { formatCents } from "@/lib/money";
import { PRACTICE_LOG_DAYS } from "@/config/practice-cards";
import { STAGE_AGES } from "@/config/retirement";
import {
  THEME_ALTERNATIVE_EVIDENCE,
  THEME_EVIDENCE,
  THEME_EVIDENCE_SOURCE,
  themeConfidence,
} from "@/config/theme-evidence";
import {
  THEME_HOLD_DAYS,
  THEME_IDS,
  THEME_SLICE_BY_LEVEL,
  THEME_STOP_LOSS,
  THEMES,
} from "@/config/themes";
import { STRATEGY_NOT_A_FORECAST } from "@/config/strategies";
import { CRYPTO_EVIDENCE, CRYPTO_EVIDENCE_SOURCE } from "@/config/crypto-evidence";
import { CRYPTO_STRATEGIES, CRYPTO_STRATEGY_IDS, CRYPTO_WARNING } from "@/config/crypto-strategies";
import { INTRADAY_EVIDENCE, INTRADAY_EVIDENCE_SOURCE } from "@/config/intraday-evidence";
import { INTRADAY_RULE_IDS, INTRADAY_RULES, INTRADAY_WARNING } from "@/config/intraday-strategies";
import { MENU_STRATEGIES, MENU_STRATEGY_IDS } from "@/config/strategy-menu";
import {
  MENU_EVIDENCE,
  MENU_EVIDENCE_RANGE,
  MENU_EVIDENCE_SOURCE,
} from "@/config/strategy-menu-evidence";
import { practiceProfileOf } from "@/lib/practice/preferences";
import { tradeLog } from "@/lib/practice/autopilot";
import { loadPractice } from "@/lib/practice/portfolio";
import { practiceIdeasFor } from "./practice-ideas";
import { PRACTICE_ONLY_NOTE, RULE_LABELS } from "./practice-copy";

// Claude's tools for investment questions in Jane's chat (spec step 128 on): read-only,
// scoped to the person, and every dollar figure recorded for the guardrails. Each later
// investment step adds its tools here; ../claude-tools.ts lists and runs them.

const noInput = { type: "object" as const, properties: {}, additionalProperties: false };

export const INVESTMENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "holdings",
    description:
      "What the person owns in their investment and retirement accounts: each account's balance and type (401(k), IRA, brokerage), and each holding's name, ticker, shares, price, value, what they paid (cost basis) and gain or loss, the fund's yearly cost (expense ratio) when known, and where the numbers came from. The total is the same as in net worth.",
    input_schema: noInput,
  },
  {
    name: "investor_profile",
    description:
      "What the person's investments are for, from their own answers: age, when they need the money, how they'd feel about a drop, their goals, and the risk level that follows (the lower of what their timeline allows and what they're comfortable with). Says which questions are still unanswered; nothing should be recommended from it until it's complete.",
    input_schema: noInput,
  },
  {
    name: "investment_fees",
    description:
      "What investing costs the person, from their holdings and fee records: each fund's yearly cost (expense ratio times what's in it), advisory and account fees from the last 12 months, the total a year, and what it costs over 30 years as a low-to-high range (with growth). In demo advice mode, also each costly fund's lower-cost equivalent with the yearly saving and the 30-year range. Quote ranges as ranges.",
    input_schema: noInput,
  },
  {
    name: "portfolio_review",
    description:
      "In demo advice mode, once the investor profile is complete: the person's mix (US stocks, international stocks, bonds, cash) against the target for their risk level, which parts are off target and by how much, any one company's shares that are too big a part (and whether it's their employer), cash above their target mix (not idle cash, which means cash beyond a few months of spending), and what to change with the reason. Never say what returns will be.",
    input_schema: noInput,
  },
  {
    name: "retirement_plan",
    description:
      "In demo advice mode, once the investor profile is complete: what the person's retirement accounts could grow to by 67 as a low-to-high range in today's dollars, what that could pay out a year, the target (10 times pay) and whether they're on track, the employer match captured or missed, room left under this year's limit and any catch-up, Roth or traditional, and what to change. Always quote ranges; never promise.",
    input_schema: noInput,
  },
  {
    name: "rebalance_plan",
    description:
      "In demo advice mode, once the investor profile is complete: the orders that would move each account to the recommended mix (sell and buy, amounts, which account), the mix before and after, and the gain or loss the sales would realise in a taxable account (an estimate). Orders go to a simulated brokerage: say no real money moves. To let the person place them, use propose_action with invest.rebalance.",
    input_schema: noInput,
  },
  {
    name: "auto_invest",
    description:
      "Automatic investing (demo advice mode): whether it's on or paused, how much goes in each payday (a set amount, or the rest after bills and goals), which account, the last few paydays (invested, or paused and why), and Jane's suggested amount if it isn't set up. Contributions go through a simulated brokerage: no real money moves. Safe to spend always comes first.",
    input_schema: noInput,
  },
  {
    name: "account_plan",
    description:
      "Which account to put money into first (employer match, HSA, IRA (Roth or traditional by their tax bracket from the tax estimate), the rest of the workplace plan, a taxable account), each with its yearly room and why, changing with the investor profile (money needed soon goes somewhere flexible); which holdings in a taxable account would be better kept in a tax-deferred one and what they cost in tax a year; and gains and losses not yet taxed. The order and moves are demo advice only; the gains are facts.",
    input_schema: noInput,
  },
  {
    name: "investments_overview",
    description:
      "How the person's investments stand this month: the total, the change from a month ago (from daily balances, counting what went in), what went in last month, fees a year, whether the mix is on target (demo advice), whether orders are ready, and what Jane does with investments by herself at their autopilot level. Facts about the past only: never say where markets are going.",
    input_schema: noInput,
  },
  {
    name: "investment_returns",
    description:
      "How the person's investments have done over the last month, 3 months and 12 months: the time-weighted return (what they own, leaving out money paid in), the money-weighted return (their own money, timing included), a similar mix of index funds for comparison, money paid in, and dividends and interest received. Past results only: never say what comes next.",
    input_schema: noInput,
  },
  {
    name: "goal_buckets",
    description:
      "In demo advice mode: each of the person's goals (and retirement) with how far away it is, the mix it's invested in by the glide path (cash under 3 years, safer as the date nears, stocks capped by their risk level), what it needs a month, and whether Jane splits automatic investing's new money by goal by herself at their autopilot level.",
    input_schema: noInput,
  },
  {
    name: "college_plan",
    description:
      "In demo advice mode: what college could cost for a child of a given age (public in-state or private), as a low-to-high range when they start, the monthly amount to get there as a range, and the 529 plans compared on fees and the state tax break from the tax profile's state. Without child_age, the person's existing college plans. To set one up, the person types the age and taps Start saving for college.",
    input_schema: {
      type: "object",
      properties: {
        child_age: { type: "number", description: "The child's age now, 0 to 17." },
        college_type: { type: "string", enum: ["public", "private"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "hsa",
    description:
      "The person's HSA: balance, cash and invested, the cash cushion, how much of the cash is beyond it (demo advice: worth investing), the year's limit for their cover (self or family, catch-up from 55) and the room left, and the receipts vault: medical charges from their transactions saved to pay back tax-free later.",
    input_schema: noInput,
  },
  {
    name: "company_stock",
    description:
      "Stock from where the person works: shares held in each account, grants still to vest (RSUs, ESPP, options), and the share of what they've invested, against the common 10% limit. In demo advice mode, the plan to sell down in parts three months apart (oldest shares first), each part's estimated tax on the gain, and how much a 50% drop would cost before and after. Selling is the person's tap on Jane's message or the company stock page, never yours.",
    input_schema: noInput,
  },
  {
    name: "retirement_accounts",
    description:
      "Every retirement contribution limit this year (workplace plan and IRAs, with catch-up from 50) with what the person has put in and the room left; in demo advice mode also the employer match left on the table in dollars a year, Roth or traditional by their bracket (from their tax estimate), whether a Roth IRA is open to their income or needs the backdoor route, and the taps Jane can do (raise the payroll contribution through the payroll stand-in; put money in an IRA). The backdoor Roth is explained, never done for them.",
    input_schema: noInput,
  },
  {
    name: "old_accounts",
    description:
      "Retirement plans left at past employers: each employer (from payroll history or what the person told Jane) with where it stands (asked once, found, rolling over, rolled over), a found plan's balance and its yearly fees now versus in a low-cost index fund, and the rollover's tracked steps. A rollover is a direct transfer to an IRA: never a withdrawal, never a check to the person. The person taps to start one; never suggest rolling into a Roth (it's taxed).",
    input_schema: noInput,
  },
  {
    name: "retirement_income",
    description:
      "Turning savings into a retirement paycheck: Social Security's monthly benefit if started at 62, 67 or 70 (from the person's statement or an estimate from pay, with which) and the age waiting has paid more by; the age required minimum distributions start (73 or 75) and the first year's minimum; the order to draw from accounts; and, in demo advice mode, how long the money lasts at their spending as a range and the most a month that lasts to 95. In today's dollars. State only these ranges: never promise income or say what markets will do.",
    input_schema: noInput,
  },
  {
    name: "family_investing",
    description:
      "The person's children in investing: each child's custodial account balance, whether they have earned income for a Roth IRA and the room this year (the lower of what they earned and the IRA limit), the college fund's progress, and whether a gift link is active with the gifts received. Never repeat or invent a gift link: it lives only on the family page.",
    input_schema: noInput,
  },
  {
    name: "property",
    description:
      "Homes and rentals as investments: each home's value (the person's own), what's owed and the equity; each rental's last 12 months from its own transactions (rent in, mortgage paid, property tax, repairs and insurance, cash flow, profit, depreciation for the year and the taxable profit, cash-on-cash return); and, in demo advice mode, paying the mortgage down against investing an extra amount a month, always with both sides (interest saved for certain; investing as a range with no guarantee). Report both sides; don't pick one unless the tool's verdict is clear.",
    input_schema: noInput,
  },
  {
    name: "costly_products",
    description:
      "Variable annuities, whole life policies and advisory fees the person has (found from their payments and fee transactions, or entered from a statement): the yearly cost in dollars, the surrender charge now, in dollars, and the date it reaches zero, what the same money could be worth in a low-cost fund as a range (a cost difference, not a forecast), and in demo advice mode when leaving costs less than staying. NEVER tell the person to leave, cancel or surrender without quoting the surrender charge and when it ends; on real accounts report the facts only.",
    input_schema: noInput,
  },
  {
    name: "yearly_review",
    description:
      "The yearly investing review in one list: what Jane did by herself within the person's caps and what is waiting for their tap; retirement account room and the employer match; old 401(k)s that could come home; whether the mix has drifted; tax-loss harvesting chances; what investing costs; and every goal with what it still needs. Report it as the list it is; every change is the person's own tap on Jane's message, never something you do.",
    input_schema: noInput,
  },
  {
    name: "asset_location",
    description:
      "Where each kind of investment sits across the person's accounts and, in demo advice mode, the swaps that would put bonds where interest isn't taxed each year and stocks in taxable or Roth accounts: each swap's amount, the tax it would cost if it sells at a gain, the yearly tax saved, and that the overall mix stays exactly the same. The person taps to make the tax-free swaps; never do it yourself.",
    input_schema: noInput,
  },
  {
    name: "plan_menu",
    description:
      "The person's workplace plan (401(k) or 403(b)) fund list as they confirmed it from the plan's fee disclosure, each fund's cost, and in demo advice mode the cheapest mix of those funds for their target with the fee saving in dollars a year, and a target-date fund's fee against building its mix by hand. Only funds on the confirmed list may ever be named as suggestions. A change goes to the payroll stand-in on the person's tap, never by you.",
    input_schema: noInput,
  },
  {
    name: "honest_performance",
    description:
      "How the person's investments really did over 1, 3 and 5 years: before fees, after fees, after fees and taxes, their money's return counting when it went in and out, a simple benchmark mix with their risk level (index funds, from config), the gap, and the reasons it adds up from: fund costs, cash held, tax on payouts, timing, and the mix itself. Report only what happened. NEVER forecast, predict or imply future returns.",
    input_schema: noInput,
  },
  {
    name: "family_file",
    description:
      "Which of the person's accounts name a beneficiary and which don't, or have names that are out of date after a marriage, divorce or birth; whether transfer-on-death could be set up; and what the person has picked to share in their family file. Facts only. For wills and trusts say only the facts and that an estate-planning attorney in their state is the person to ask; never advise on whether to make one, which kind, or what it should say.",
    input_schema: noInput,
  },
  {
    name: "values_investing",
    description:
      "What the person leaves out of their funds (fossil fuels, weapons, tobacco) or leans towards (clean energy), and what applying it to the funds they hold would change: which funds switch, the fee change in dollars a year, any tax on a sale in a taxable account, and what it does to diversification (fewer holdings). It never changes the stocks-and-bonds mix. The switch is the person's own tap on Jane's message; never trade yourself. Recommendations only in demo advice mode.",
    input_schema: noInput,
  },
  {
    name: "short_term_money",
    description:
      "Money the person needs within three years (goals due soon with money saved, and the emergency fund above its floor): high-yield savings, Treasury bills, CDs and I bonds compared after tax at their own federal and state rates (Treasury interest is free of state tax), listing only places that can't lock the money past its date, and a Treasury bill ladder that matures when it's needed and rolls itself over until then. The emergency fund's floor stays in savings. The person taps to build a ladder; never do it yourself.",
    input_schema: noInput,
  },
  {
    name: "sudden_money",
    description:
      "A large deposit that isn't pay (a bonus, inheritance, home or other sale, gift), once the person has said which, and its staged plan in order: the tax to set aside first (figured by kind, with its source), high-interest debt, the emergency fund, retirement limits, goals, then investing, each part with its amount. Every part is the person's own tap on Jane's message; never move money yourself. No tax advice beyond the set-aside shown.",
    input_schema: noInput,
  },
  {
    name: "steady_hand",
    description:
      "Whether the person's investments have had a big drop lately (down 8% over a month or 15% over three, their own return, money in and out left out) and, in demo advice mode, how each goal's timeline sits (near goals are already in cash). Report only these past facts and the plan to stay the course. NEVER say or imply what markets will do, when they will recover, or that now is a good or bad time: no one can know.",
    input_schema: noInput,
  },
  {
    name: "cash_plan",
    description:
      "The person's cash in checking, savings and their brokerage's sweep, each with a typical rate (stand-ins with their date). In demo advice mode, the plan: a month of spending in checking, the emergency fund in high-yield savings (in reach within days, never anywhere slower), the rest in a money market fund or a Treasury ladder, with what each earns a year and the moves Jane can make with the person's tap.",
    input_schema: noInput,
  },
  {
    name: "crypto",
    description:
      "The person's crypto, read-only from their exchanges and wallets: each connection with its source and when it was read, each asset's amount, price and value, the total and its share of everything invested. In demo advice mode, two flags: a share above about 5%, and exchange fees well above low-cost exchanges'. Jane never buys, sells or moves crypto, at any level: there's no way to, so never offer to.",
    input_schema: noInput,
  },
  // Spec step 297: the practice portfolio, for "what did you buy this week and why".
  {
    name: "practice_portfolio",
    description:
      "The person's practice portfolio (demo advice mode only): a paper portfolio Jane runs on practice money, never real money, at a risk level (Very low to Very high). Gives the level, what it's worth and started with, cash, each position, whether Jane is paused (all trading, or opportunities only), this week's trades with the rule and the reason for each, the ideas Jane is waiting on the person for (each with how sure she is, as a percent, and why), the strategy the autopilot follows today and whether the person's settings let it, and what their yes and no to past ideas changed (which kinds now come sooner or later). For \"what are you thinking of doing\", \"what strategy is mine on\" or \"have you learned what I like\". Say plainly that it's practice money and nothing real was bought or sold. To pause or resume it, offer practice.pause or practice.resume with propose_action; you can't change it yourself.",
    input_schema: noInput,
  },
  // Phase AW: the strategy menu, each replayed at the person's level against their mix.
  {
    name: "strategy_menu",
    description:
      'The strategy menu for the practice portfolio (demo advice mode only): well-known ways to run it besides Jane\'s pick for the person\'s level (value, momentum and quality tilts, dividend growth, equal weight, sector rotation, all-weather risk parity), and at Very high a small crypto sleeve (bitcoin and ether held, or run by a trend or momentum rule, against holding since 2022, with its warning, which the practice portfolio can run as a sleeve at Very high) and day-trading rules on SPY\'s 5-minute bars (an opening-range break, a liquidity sweep of the prior day\'s low, a fair value gap, VWAP reversion, a volume imbalance; each after slippage against holding since 2024, with the warning that most day traders lose money, which the practice portfolio can also run as a sleeve at Very high), each replayed on real prices after costs at the person\'s level, with how it works, its yearly return and worst drop against the level\'s own mix over the same days (the whole replay and the years since 2022), whether it gave more or less return for its risk, and the levels it fits. For "what other strategies are there", "is momentum better", "how does all-weather work" or "can I day trade". Always call it a replay of the past, never a forecast, and say plainly when a strategy did worse than the mix.',
    input_schema: noInput,
  },
  // Phase AW: the news themes the practice portfolio watches, and how each did before.
  {
    name: "news_themes",
    description:
      'The news themes Jane watches for the practice portfolio (demo advice mode only): each kind of event (a Middle East supply shock, a war, a market scare, a Fed rate cut, a chip boom), the fund it points to, and how that fund did on the theme\'s past events against the whole US market over about a month, with the confidence and whether Jane offers it (only the ones that held up are). Also the slice by level and when the idea gets out. For "what do you do when there\'s a war", "should I buy oil" or "what news do you watch". Always call the numbers a replay of the past, never a forecast, and say when a theme didn\'t hold up.',
    input_schema: noInput,
  },
  {
    name: "explainer",
    description:
      "Jane's fixed plain-language explainer for a word (education, not advice; waiting for counsel's review): what it is and how it works, with sources. Use it when the person asks what something means, and quote it rather than writing your own definition.",
    input_schema: {
      type: "object",
      properties: { slug: { type: "string", enum: EXPLAINERS.map((e) => e.slug) } },
      required: ["slug"],
      additionalProperties: false,
    },
  },
];

// What the person sees while Jane looks it up.
export const INVESTMENT_TOOL_STATUS: Readonly<Record<string, string>> = {
  holdings: "Looking at what you own…",
  investor_profile: "Checking your investor profile…",
  investment_fees: "Adding up your investment fees…",
  portfolio_review: "Reviewing your investments…",
  retirement_plan: "Looking at your retirement…",
  rebalance_plan: "Working out the orders…",
  auto_invest: "Checking automatic investing…",
  account_plan: "Working out which account first…",
  explainer: "Looking that up…",
  hsa: "Checking your HSA…",
  company_stock: "Looking at your company stock…",
  crypto: "Reading your crypto balances…",
  cash_plan: "Looking at where your cash sits…",
  steady_hand: "Looking at how your investments have moved…",
  sudden_money: "Planning your windfall…",
  short_term_money: "Comparing safe places for money you need soon…",
  values_investing: "Checking your funds against your values…",
  family_file: "Checking who is named on your accounts…",
  honest_performance: "Comparing you with a benchmark…",
  plan_menu: "Looking at your plan's funds…",
  asset_location: "Checking which account holds what…",
  yearly_review: "Putting your investing review together…",
  costly_products: "Adding up what your products cost…",
  property: "Looking at your property…",
  family_investing: "Looking at your children's accounts…",
  retirement_income: "Working out your retirement income…",
  old_accounts: "Looking for old retirement accounts…",
  retirement_accounts: "Checking your retirement limits…",
  college_plan: "Working out college costs…",
  goal_buckets: "Looking at your goals…",
  investment_returns: "Working out your returns…",
  investments_overview: "Looking at how your investments are doing…",
};

export const isInvestmentTool = (name: string) => INVESTMENT_TOOLS.some((t) => t.name === name);

export async function runInvestmentTool(
  userId: string,
  name: string,
  input: unknown,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<ToolOutput> {
  const cents: number[] = [];
  const money = (value: number) => {
    cents.push(Math.abs(value));
    return value < 0 ? `-${formatCents(-value)}` : formatCents(value);
  };
  const out = (value: unknown): ToolOutput => ({ content: JSON.stringify(value), cents });

  switch (name) {
    case "holdings": {
      const data = await loadInvestments(userId, { client, now });
      if (data.accounts.length === 0) {
        return out({ note: "No investment or retirement accounts are linked." });
      }
      return out({
        total: money(data.totalCents),
        retirement: money(data.byKind.retirement),
        otherInvesting: money(data.byKind.investment),
        byAssetClass: data.byAssetClass.map((c) => ({ type: c.label, value: money(c.valueCents) })),
        accounts: data.accounts.map((a) => ({
          name: a.name,
          type: a.label,
          from: a.institution,
          balance: a.balanceCents === null ? null : money(a.balanceCents),
          holdingsAddUpToBalance: a.holdingsMatch,
          holdings: a.holdings.map((h) => ({
            name: h.name,
            ticker: h.ticker,
            kind: h.category ?? h.type,
            shares: h.isCash ? null : h.quantity,
            price: h.isCash ? null : money(h.priceCents),
            value: money(h.valueCents),
            paid: h.costBasisCents === null || h.isCash ? null : money(h.costBasisCents),
            gainOrLoss: h.gainCents === null ? null : money(h.gainCents),
            yearlyCost: h.expenseRatioBps === null ? null : formatBps(h.expenseRatioBps),
            source: h.source,
          })),
        })),
      });
    }
    case "investor_profile": {
      const summary = profileSummary(
        await profileOf(userId, { client }),
        now.toISOString().slice(0, 10),
      );
      if (!summary.complete) {
        return out({
          complete: false,
          answered: summary.answered,
          nextQuestion: summary.next.text,
          note: "Not finished: don't recommend anything that depends on it. The person can answer in the chat or on /investments/profile.",
        });
      }
      return out({
        complete: true,
        riskLevel: summary.label,
        why: summary.why,
        age: summary.age,
        needsTheMoney: HORIZONS[summary.horizon].label,
        goals: summary.goals.map((g) => GOALS[g]),
        answeredOverAYearAgo: summary.stale,
      });
    }
    case "investment_fees": {
      const [{ fees }, advice] = await Promise.all([
        loadFees(userId, { client, now }),
        adviceMode(userId, { client }),
      ]);
      const span = (r: { lowCents: number; highCents: number }) => ({
        low: money(r.lowCents),
        high: money(r.highCents),
      });
      return out({
        aYear: money(fees.totalYearlyCents),
        fundCostsAYear: money(fees.fundsYearlyCents),
        advisoryFeesLast12Months: money(fees.advisoryCents),
        accountFeesLast12Months: money(fees.accountFeesCents),
        [`over${fees.years}Years`]: span(fees.overYears),
        funds: fees.funds.map((f) => ({
          name: f.holding.name,
          account: f.accountName,
          yearlyCost: formatBps(f.expenseRatioBps),
          aYear: money(f.yearlyCents),
        })),
        costNotKnown: fees.unknown,
        lowerCostEquivalents: advice
          ? fees.equivalents.map((e) => ({
              instead: e.holding.name,
              account: e.accountName,
              hold: e.name,
              ticker: e.ticker,
              kind: e.category,
              itsYearlyCost: formatBps(e.expenseRatioBps),
              offeredInPlan: e.inPlanMenu,
              savingAYear: money(e.yearlySavingCents),
              [`savingOver${fees.years}Years`]: span(e.overYears),
            }))
          : "Not shown: recommendations are for demo advice mode only.",
      });
    }
    case "portfolio_review": {
      const [{ profile, review }, advice] = await Promise.all([
        loadReview(userId, { client, now }),
        adviceMode(userId, { client }),
      ]);
      if (!advice) return out({ note: "Reviews are for demo advice mode only." });
      if (!review || !profile.complete) {
        return out({
          note: "The investor profile isn't finished, so there's no target to review against. Suggest answering it (ask: \"my risk profile\").",
        });
      }
      return out({
        riskLevel: review.riskLabel,
        total: money(review.totalCents),
        mix: review.mix.map((m) => ({
          kind: m.label,
          now: `${Math.round(m.share * 100)}%`,
          target: `${Math.round(m.targetShare * 100)}%`,
          value: money(m.valueCents),
          toReachTarget: money(m.changeCents),
          offTarget: m.offTarget,
        })),
        tooMuchInOneCompany: review.concentrated.map((c) => ({
          name: c.holding.name,
          share: `${Math.round(c.share * 100)}%`,
          employer: c.employer,
          sellToReachLimit: money(c.overCents),
        })),
        cashAboveYourTargetMix: money(review.cashAboveTargetCents),
        whatToChange: review.recommendations.map((r) => ({
          what: r.what,
          why: r.why,
          amount: money(r.amountCents),
        })),
        leftOut: review.leftOut,
      });
    }
    case "retirement_plan": {
      const [first, advice] = await Promise.all([
        loadRetirement(userId, { client, now }),
        adviceMode(userId, { client }),
      ]);
      if (!advice) return out({ note: "The retirement planner is for demo advice mode only." });
      // No age from the investor profile: answer anyway, with an age standing for the stage of
      // life Jane works out from their data, said as a guess.
      let data = first;
      if (!first.retirement && first.accounts.length > 0) {
        const { loadProfile } = await import("@/lib/profile");
        const stage = (await loadProfile(userId, { client, now })).facts.life_stage.value;
        const guessedAge = typeof stage === "string" ? (STAGE_AGES[stage] ?? null) : null;
        if (guessedAge !== null) data = await loadRetirement(userId, { client, now, guessedAge });
      }
      const plan = data.retirement;
      if (!plan) {
        return out({
          note: "No plan yet: the investor profile isn't finished or there's no retirement account.",
          balance: money(data.balanceCents),
        });
      }
      const span = (r: { lowCents: number; highCents: number }) => ({
        low: money(r.lowCents),
        high: money(r.highCents),
      });
      return out({
        ...(data.ageGuessed
          ? {
              estimate: `Worked out from their accounts, with their age guessed from their stage of life (about ${plan.retirementAge - plan.years}): say it's an estimate, and ask their age and goals to sharpen it.`,
            }
          : {}),
        balanceNow: money(data.balanceCents),
        accounts: data.accounts,
        retirementAge: plan.retirementAge,
        projectionInTodaysDollars: span(plan.projection),
        couldPayOutAYear: span(plan.yearlyIncome),
        target: plan.targetCents === null ? null : money(plan.targetCents),
        status: plan.status,
        match: plan.match && {
          youPutInShareOfPay: `${Math.round(plan.match.employeeRate * 1000) / 10}%`,
          getAllOfIt: plan.match.captured,
          missedAYear: money(plan.match.missedCents),
          putInThisMuchForAllOfIt: `${Math.round(plan.match.fullMatchRate * 1000) / 10}%`,
        },
        roomLeftThisYear: money(plan.roomCents),
        catchUp: money(plan.catchUpCents),
        rothOrTraditional: plan.rothOrTraditional,
        whatToChange: plan.changes.map((c) => {
          c.figures.forEach(money);
          return { what: c.what, why: c.why, extraAYear: money(c.extraYearlyCents) };
        }),
      });
    }
    case "rebalance_plan": {
      const { advice, plan } = await loadRebalance(userId, { client, now });
      if (!advice) return out({ note: "Trading is for demo advice mode only." });
      if (!plan)
        return out({ note: "The investor profile isn't finished, so there's no target mix." });
      const pct = (s: number) => `${Math.round(s * 100)}%`;
      return out({
        brokerage: "simulated: no real money moves",
        orders: plan.orders.map((o) => ({
          account: o.accountName,
          side: o.side,
          fund: o.name,
          amount: money(o.amountCents),
          realisedGainEstimate: o.gainCents === null ? null : money(o.gainCents),
        })),
        before: plan.before.map((m) => ({
          kind: m.label,
          share: pct(m.share),
          target: pct(m.target),
        })),
        after: plan.after.map((m) => ({
          kind: m.label,
          share: pct(m.share),
          target: pct(m.target),
        })),
        realisedGainEstimate: money(plan.realisedGainCents),
      });
    }
    case "auto_invest": {
      const data = await loadAutoInvest(userId, { client, now });
      if (!data.advice) return out({ note: "Automatic investing is for demo advice mode only." });
      return out({
        brokerage: "simulated: no real money moves",
        profileComplete: data.profileComplete,
        plan: data.plan && {
          status: data.plan.status,
          mode: data.plan.mode === "leftover" ? "the rest after bills and goals" : "a set amount",
          eachPayday: data.plan.amountCents === null ? null : money(data.plan.amountCents),
          into: data.accounts.find((a) => a.id === data.plan!.accountId)?.name ?? null,
        },
        lastPaydays: data.runs.slice(0, 5).map((r) => ({
          payday: r.paydayOn,
          status: r.status,
          invested: money(r.amountCents),
          safeToSpendThen: r.safeCents === null ? null : money(r.safeCents),
          why: r.reason,
        })),
        suggestedEachPayday: data.suggestion ? money(data.suggestion.amountCents) : null,
      });
    }
    case "account_plan": {
      const plan = await loadAccountPlan(userId, { client, now });
      const gains = {
        gainsNotYetTaxed: money(plan.gains.gainsCents),
        lossesNotYetTaxed: money(plan.gains.lossesCents),
        losers: plan.gains.losers.map((l) => ({
          name: l.name,
          account: l.accountName,
          down: money(l.lossCents),
        })),
      };
      if (!plan.advice)
        return out({ ...gains, note: "The account order is for demo advice mode only." });
      return out({
        ...gains,
        topFederalRate:
          plan.marginalRate === null ? null : `${Math.round(plan.marginalRate * 100)}%`,
        rothOrTraditional: plan.rothOrTraditional,
        order:
          plan.order?.map((s) => ({
            account: s.title,
            roomAYear: s.roomCents === null ? null : money(s.roomCents),
            why: s.why,
          })) ?? "The investor profile isn't finished.",
        whereToHoldWhat: plan.location.map((m) => ({
          holding: m.holding.name,
          now: m.accountName,
          better: m.better,
          taxAYearWhereItIs: money(m.taxDragCents),
        })),
      });
    }
    case "investments_overview": {
      const [snapshot, level, investing] = await Promise.all([
        loadInvestmentSnapshot(userId, { client, now }),
        autopilotOf(userId, { client }),
        autopilotFor(userId, "investing", { client, now }),
      ]);
      const note = overviewReply(snapshot);
      money(snapshot.totalCents);
      if (snapshot.month.previousCents !== null) {
        money(snapshot.month.previousCents);
        money(snapshot.totalCents - snapshot.month.previousCents);
      }
      money(snapshot.month.contributedCents);
      money(snapshot.fees.totalYearlyCents);
      return out({
        note: note.body,
        ordersReady: snapshot.advice ? (snapshot.rebalance?.orders.length ?? 0) : 0,
        whatJaneDoesByHerself: investmentsByHerself(level, investing),
      });
    }
    case "investment_returns": {
      const returns = await loadReturns(userId, { client, now });
      const pct = (r: number | null) => (r === null ? null : formatReturn(r));
      return out({
        asOf: returns.asOf,
        pricesFrom: returns.simulatedPrices ? "demo price feed (made up)" : "your bank",
        periods: returns.periods.map((p) => ({
          period: p.label,
          from: p.from,
          startValue: money(p.startCents),
          endValue: money(p.endCents),
          investments: pct(p.timeWeighted),
          yourMoney: pct(p.moneyWeighted),
          similarMix: pct(p.benchmark),
          paidIn: money(p.paidInCents),
          dividendsAndInterest: money(p.incomeCents),
        })),
        note: "Past results only.",
      });
    }
    case "goal_buckets": {
      const data = await loadGoalBuckets(userId, { client, now });
      if (!data.advice) return out({ note: "Investing by goal is for demo advice mode only." });
      if (!data.buckets) return out({ note: "The investor profile isn't finished." });
      const pct = (s: number) => `${Math.round(s * 100)}%`;
      return out({
        janeSplitsNewMoneyByHerself: data.byHerself,
        goals: data.buckets.map((b) => ({
          goal: b.name,
          yearsAway: Math.round(b.yearsLeft * 10) / 10,
          stocks: pct(b.mix.us_stocks + b.mix.intl_stocks),
          bonds: pct(b.mix.bonds),
          cash: pct(b.mix.cash),
          needsAMonth: money(b.monthlyCents),
          why: b.why,
        })),
      });
    }
    case "college_plan": {
      const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
      const { advice, plans } = await loadCollege(userId, { client, now });
      if (!advice) return out({ note: "College savings plans are for demo advice mode only." });
      const age = typeof args.child_age === "number" ? Math.round(args.child_age) : null;
      const describe = (e: CollegeEstimate) => ({
        childAge: e.childAge,
        college: e.type,
        startsInYears: e.years,
        fourYearCost: { low: money(e.cost.lowCents), high: money(e.cost.highCents) },
        monthlyToGetThere: { low: money(e.monthly.lowCents), high: money(e.monthly.highCents) },
        plans: e.plans.map((p) => ({
          plan: p.plan.name,
          feesAYear: money(p.feeCents),
          stateTaxBreakAYear: money(p.benefitCents),
        })),
      });
      if (age !== null && age >= 0 && age <= 17) {
        const type = args.college_type === "private" ? "private" : "public";
        return out(describe(await estimateCollege(userId, { childAge: age, type }, { client })));
      }
      return out({ plans: plans.map((p) => ({ child: p.childName, ...describe(p.estimate) })) });
    }
    case "retirement_accounts": {
      const v = await loadRetirementAccounts(userId, { client, now });
      return out({
        limits: v.limits.map((l) => ({
          account: l.label,
          limit: money(l.limitCents),
          catchUp: money(l.catchUpCents),
          putIn: money(l.usedCents),
          roomLeft: money(l.roomCents),
        })),
        advice: !v.advice
          ? "only in demo advice mode"
          : {
              matchLeftOnTheTableAYear: v.match ? money(v.match.missedCents) : null,
              rothOrTraditional: v.roth.choice,
              nextDollarTaxPercent:
                v.roth.marginalRate === null ? null : Math.round(v.roth.marginalRate * 1000) / 10,
              rothIraAccess: v.roth.access?.kind ?? null,
              canPutInAnIraNow: money(v.iraAllowedCents),
            },
      });
    }
    case "old_accounts": {
      const v = await loadOldAccounts(userId, { client, now });
      return out({
        employers: v.plans.map((p) => ({
          employer: p.employer,
          status: p.status,
          balance: p.balanceCents === null ? null : money(p.balanceCents),
          feesAYearNow: p.fees ? money(p.fees.beforeCents) : null,
          feesAYearInIndexFund: p.fees && v.advice ? money(p.fees.afterCents) : null,
          steps: p.steps.map((s) => ({ step: s.label, done: s.doneOn })),
        })),
        rolloverIsAWithdrawal: false,
      });
    }
    case "retirement_income": {
      const v = await loadRetirementIncome(userId, { client, now });
      return out({
        socialSecurity: {
          source: v.ss.source,
          options: v.ss.options.map((o) => ({
            startAge: o.age,
            monthly: money(o.monthlyCents),
            totalByAge85: money(o.lifetimeToAgeCents),
          })),
          waitingFrom62To67PaidMoreByAge: v.ss.breakeven62to67,
          waitingFrom67To70PaidMoreByAge: v.ss.breakeven67to70,
        },
        requiredMinimumDistributions: v.rmd && {
          startAge: v.rmd.startAge,
          firstYearMinimum: v.rmd.firstYearCents === null ? null : money(v.rmd.firstYearCents),
        },
        orderToDraw: v.draw.map((d) => d.label),
        plan: !v.advice
          ? "advice only in demo advice mode"
          : v.paycheck && {
              spendingAMonth: money(v.spendMonthlyCents),
              retireAge: v.retireAge,
              moneyLastsToAge: { low: v.paycheck.lasts.lowAge, high: v.paycheck.lasts.highAge },
              mostAMonthThatLastsTo95: {
                low: money(v.paycheck.sustainableMonthly.lowCents),
                high: money(v.paycheck.sustainableMonthly.highCents),
              },
            },
      });
    }
    case "family_investing": {
      const v = await loadFamily(userId, { client, now });
      return out({
        children: v.children.map((c) => ({
          name: c.name,
          age: c.age,
          earnedIncome: money(c.earnedCents),
          custodialBalance: c.custodial ? money(c.custodial.balanceCents) : null,
          rothRoomThisYear: v.advice && c.roth ? money(c.roth.roomCents) : null,
          collegeFundPercent: c.college?.percent ?? null,
          giftLinkActive: c.gift !== null,
          giftsReceived: c.gift ? c.gift.gifts.length : 0,
        })),
      });
    }
    case "property": {
      const v = await loadProperty(userId, { client, now });
      return out({
        homes: v.homes.map((h) => ({
          name: h.name,
          value: money(h.valueCents),
          owed: h.loanCents === null ? null : money(h.loanCents),
          equity: money(h.equityCents),
        })),
        rentals: v.rentals.map((r) => ({
          name: r.name,
          depositsCounted: r.counts.rent,
          rent: money(r.figures.rentCents),
          mortgagePaid: money(r.figures.mortgagePaidCents),
          propertyTax: money(r.figures.propertyTaxCents),
          repairsAndInsurance: money(r.figures.otherExpensesCents),
          cashFlow: money(r.figures.cashFlowCents),
          profit: money(r.figures.profitCents),
          depreciation: money(r.figures.depreciationCents),
          taxableProfit: money(r.figures.taxableCents),
          cashOnCashPercent:
            r.figures.cashOnCash === null ? null : Math.round(r.figures.cashOnCash * 1000) / 10,
        })),
        paydownVsInvesting: !v.advice
          ? "advice only in demo advice mode"
          : v.paydown && {
              extraAMonth: money(v.paydown.extraMonthlyCents),
              years: v.paydown.years,
              payingDownSavesInterest: money(v.paydown.paydown.interestSavedCents),
              investingCouldGain: {
                low: money(v.paydown.invest.lowGainCents),
                high: money(v.paydown.invest.highGainCents),
              },
              verdict: v.paydown.verdict,
            },
      });
    }
    case "costly_products": {
      const v = await loadCostlyProducts(userId, { client, now });
      return out({
        products: v.products.map((p) => ({
          name: p.name,
          kind: p.kind,
          provider: p.provider,
          value: money(p.valueCents),
          costAYear: p.yearlyCostCents === null ? null : money(p.yearlyCostCents),
          surrenderChargeNow: p.surrender && {
            percent: p.surrender.pctNow,
            dollars: money(p.surrender.cents),
            reachesZeroOn: p.surrender.endsOn,
          },
          sameMoneyInLowCostFund: v.advice
            ? p.gap
              ? {
                  extraAfterYears: p.gap.years,
                  low: money(p.gap.lowCents),
                  high: money(p.gap.highCents),
                }
              : p.wholeLife && {
                  low: money(p.wholeLife.inFundsCents.lowCents),
                  high: money(p.wholeLife.inFundsCents.highCents),
                  paidIn: money(p.wholeLife.paidCents),
                }
            : "advice only in demo advice mode",
          leavingVsStaying:
            v.advice && p.exit
              ? {
                  verdict: p.exit.verdict,
                  stayCost: money(p.exit.stayCents),
                  leaveNowCost: money(p.exit.leaveNowCents),
                  surrenderIncluded: money(p.exit.surrenderNowCents),
                  waitYears: p.exit.bestWaitYears,
                }
              : null,
        })),
        advisory: v.advisory && {
          paidLast12Months: money(v.advisory.yearlyCents),
          assets: money(v.advisory.assetsCents),
          percent: v.advisory.feeBps / 100,
        },
      });
    }
    case "yearly_review": {
      const snapshot = await loadInvestmentSnapshot(userId, { client, now });
      if (!snapshot.advice) return out({ advice: "only in demo advice mode" });
      const review = reviewFor(snapshot, now.getUTCFullYear());
      return out({
        reason: review.input.reason,
        items: review.items.map((i) => ({ item: i.key, status: i.status, line: i.line })),
        needsATap: review.buttons.map((b) => b.label),
      });
    }
    case "asset_location": {
      const v = await loadLocation(userId, { client, now });
      if (!v.advice) return out({ advice: "only in demo advice mode" });
      return out(
        v.plan
          ? {
              overallMixUnchanged: true,
              taxOnPayoutsNowAYear: money(v.plan.taxNowCents),
              afterAYear: money(v.plan.taxAfterCents),
              savedAYear: money(v.plan.savedCents),
              swaps: v.plan.swaps.map((s) => ({
                between: [s.a.accountName, s.b.accountName],
                each: money(s.amountCents),
                taxIfItSellsAtAGain: money(s.taxCents),
              })),
            }
          : { note: "needs two or more investment accounts" },
      );
    }
    case "plan_menu": {
      const v = await loadPlanMenu(userId, { client, now });
      return out({
        confirmedMenu:
          v.menu &&
          v.menu.funds.map((f) => ({
            ticker: f.ticker,
            name: f.name,
            costPercent: f.expenseBps / 100,
            kind: f.kind,
          })),
        waitingForConfirmation: v.proposed !== null,
        suggestion: !v.advice
          ? "advice only in demo advice mode"
          : v.plan && {
              costsNowAYear: money(Math.round((v.plan.balanceCents * v.plan.currentBps) / 10_000)),
              cheapestMix: v.plan.suggested.map((a) => ({
                ticker: a.ticker,
                sharePercent: Math.round(a.share * 100),
                costPercent: a.expenseBps / 100,
              })),
              savesAYear: money(v.plan.savingCents),
              targetDateFunds: v.plan.targetDates
                .filter(Boolean)
                .map((t) => ({ ticker: t!.ticker, savingBuildingItByHand: money(t!.savingCents) })),
            },
      });
    }
    case "honest_performance": {
      const v = await loadHonest(userId, { client, now });
      return out({
        periods: v.rows.map((r) => ({
          period: r.label,
          from: r.from,
          shorterHistory: r.shorter,
          beforeFeesPercent: Math.round(r.beforeFees * 1000) / 10,
          afterFeesAndTaxesPercent: Math.round(r.afterTaxes * 1000) / 10,
          yourMoneyPercent:
            r.moneyWeighted === null ? null : Math.round(r.moneyWeighted * 1000) / 10,
          benchmarkPercent: Math.round(r.benchmark * 1000) / 10,
          gapPoints: Math.round(r.gap * 1000) / 10,
          reasonsPoints: r.reasons.map((x) => ({
            reason: x.label,
            points: Math.round(x.points * 1000) / 10,
          })),
        })),
        forecast: "never",
      });
    }
    case "family_file": {
      const v = await loadFamilyFile(userId, { client });
      return out({
        accounts: v.checks.map((c) => ({
          account: c.accountName,
          kind:
            c.type === "tod"
              ? "can be set up to pass to someone (transfer-on-death)"
              : "takes a beneficiary",
          named: c.names,
          problems: c.problems,
          since: c.because,
        })),
        lifeEvents: v.events,
        sharing: v.picks,
        about_wills_and_trusts: [...v.facts, v.pointer],
      });
    }
    case "values_investing": {
      const v = await loadValues(userId, { client, now });
      return out({
        leaveOut: v.prefs.excludes,
        leanTowards: v.prefs.themes,
        plan:
          v.advice && v.plan
            ? {
                switches: v.plan.switches.map((s) => ({
                  account: s.accountName,
                  from: s.from.name,
                  to: s.legs.map((l) => l.name),
                  feeChangeAYear: money(s.feeDeltaCents),
                })),
                totalFeeChangeAYear: money(v.plan.feeDeltaCents),
                gainRealised: money(v.plan.gainCents),
                diversification: v.plan.diversification,
                notes: v.plan.notes,
              }
            : "only in demo advice mode",
      });
    }
    case "short_term_money": {
      const v = await loadShortTerm(userId, { client, now });
      if (!v.advice) return out({ advice: "only in demo advice mode" });
      return out({
        yourRates: {
          federalPercent: Math.round(v.fed * 100),
          statePercent: Math.round(v.state * 100),
        },
        money: v.candidates.map((c) => ({
          for: c.name,
          amount: money(c.amountCents),
          neededBy: c.endsOn,
          afterTaxPercent: c.options.map((o) => ({
            where: o.product.name,
            percent: o.afterTaxBps / 100,
          })),
          ladderExtraAYear: c.ladder ? money(c.gainCents) : null,
          alreadyLaddered: c.hasLadder,
        })),
        ladders: v.ladders.map((l) => ({
          name: l.name,
          amount: money(l.amountCents),
          cashOn: l.endsOn,
          rolledOver: l.events.length,
          status: l.status,
        })),
      });
    }
    case "sudden_money": {
      const v = await loadSuddenMoney(userId, { client, now });
      return out({
        deposits: v.items.map((i) => ({
          amount: money(i.amountCents),
          on: i.depositedOn,
          kind: i.kind ?? "not yet said",
          taxSetAside:
            i.tax && v.advice
              ? { amount: money(i.tax.cents), note: i.tax.note, source: i.tax.source }
              : null,
          stages: v.advice
            ? i.stages.map((s) => ({ stage: s.title, amount: money(s.cents), done: s.done }))
            : "advice only in demo advice mode",
        })),
      });
    }
    case "steady_hand": {
      const view = await loadSteadyHand(userId, { client, now });
      return out(
        !view.advice
          ? { advice: "only in demo advice mode" }
          : {
              bigDrop: view.drop && {
                over: view.drop.windowLabel,
                returnPercent: Math.round(view.drop.rate * 1000) / 10,
              },
              goals: view.buckets.map((b) => ({
                goal: b.name,
                yearsAway: Math.round(b.yearsLeft * 10) / 10,
                alreadyInCash: b.nearTerm,
              })),
              plan: "stay the course: automatic investing and each goal's mix carry on",
              markets: "never predicted",
            },
      );
    }
    case "cash_plan": {
      const view = await loadCash(userId, { client, now });
      return out({
        ratesAsOf: CASH_RATES_AS_OF,
        places: view.places.map((p) => ({
          name: p.name,
          kind: p.kind,
          balance: money(p.balanceCents),
          ratePercent: p.rateBps / 100,
        })),
        monthlySpending: money(view.monthlySpendingCents),
        emergencyFund: money(view.emergencyTargetCents),
        emergencyFundFrom: view.emergencyFromGoal ? "their goal" : "3 months of their spending",
        homes: CASH_HOMES.map((h) => ({
          name: h.name,
          ratePercent: h.rateBps / 100,
          daysToReach: h.reachDays,
        })),
        plan: !view.advice
          ? "advice only in demo advice mode"
          : view.plan && {
              buckets: view.plan.buckets.map((b) => ({
                job: b.label,
                amount: money(b.cents),
                where: b.home?.name ?? "checking",
              })),
              earnsNowAYear: money(view.plan.nowYearlyCents),
              wouldEarnAYear: money(view.plan.afterYearlyCents),
              moves: view.plan.moves.map((m) => ({
                from: m.fromName,
                to: m.toName,
                amount: money(m.cents),
                moreAYear: money(m.gainCents),
              })),
            },
      });
    }
    case "practice_portfolio": {
      if (!(await adviceMode(userId, { client }))) return out({ note: PRACTICE_ONLY_NOTE });
      const view = await loadPractice(userId, { client, now });
      if (!view) {
        return out({
          note: "No practice portfolio yet. It can be started on the practice portfolio page, with practice money only.",
        });
      }
      const since = now.getTime() - PRACTICE_LOG_DAYS * 86_400_000;
      const week = (await tradeLog(userId, { client })).filter(
        (t) =>
          !t.undone && (t.side === "buy" || t.side === "sell") && t.placedAt.getTime() >= since,
      );
      return out({
        practiceMoneyOnly: "A paper portfolio on practice money: nothing real was bought or sold.",
        level: RISK_LEVELS[view.level].label,
        worth: money(view.totalCents),
        startedWith: money(view.startingCents),
        startedOn: view.startedAt.toISOString().slice(0, 10),
        cash: money(view.state.cashCents),
        positions: view.holdings.map((h) => ({ ticker: h.ticker, value: money(h.valueCents) })),
        paused: view.paused,
        opportunitiesPaused: view.opportunitiesPaused,
        thisWeek: week.map((t) => ({
          on: t.placedAt.toISOString().slice(0, 10),
          side: t.side,
          ticker: t.ticker,
          amount: money(t.amountCents),
          rule: RULE_LABELS[t.rule] ?? t.rule,
          reason: t.reason,
        })),
        ...(await practiceIdeasFor(userId, { client, now }, money)),
      });
    }
    case "strategy_menu": {
      if (!(await adviceMode(userId, { client }))) return out({ note: PRACTICE_ONLY_NOTE });
      const profile = await practiceProfileOf(userId, { client, now });
      const level = profile.level;
      const pct = (n: number) => Math.round(n * 1000) / 10;
      return out({
        label: DEMO_ADVICE_LABEL,
        notAForecast: STRATEGY_NOT_A_FORECAST,
        source: `${MENU_EVIDENCE_SOURCE}, ${MENU_EVIDENCE_RANGE.from} to ${MENU_EVIDENCE_RANGE.to}, after costs`,
        level: RISK_LEVELS[level].label,
        default: "Jane's pick for the level (the strategy each level follows) stays the default.",
        crypto: {
          forLevels: "Very high only, a small sleeve",
          warning: CRYPTO_WARNING,
          inThePracticePortfolio:
            "At Very high, as a sleeve the person picks: Use in practice on its card, or practice_settings crypto_sleeve.",
          practicePortfolioRuns: profile.crypto
            ? CRYPTO_STRATEGIES[profile.crypto.strategy].label
            : "no crypto sleeve",
          source: CRYPTO_EVIDENCE_SOURCE,
          strategies: CRYPTO_STRATEGY_IDS.map((id) => {
            const r = CRYPTO_EVIDENCE[id];
            return {
              strategy: CRYPTO_STRATEGIES[id].label,
              how: CRYPTO_STRATEGIES[id].how,
              setting: r.param,
              since2022YearlyPercent: pct(r.later.cagr),
              since2022WorstDropPercent: pct(r.later.maxDrawdown),
              holdingSince2022YearlyPercent: pct(r.holdLater.cagr),
              holdingSince2022WorstDropPercent: pct(r.holdLater.maxDrawdown),
              moreReturnForItsRiskThanHolding: r.beatsHolding,
            };
          }),
        },
        dayTrading: {
          forLevels: "Very high only, a small sleeve, in and out of SPY the same day",
          warning: INTRADAY_WARNING,
          inThePracticePortfolio:
            "At Very high, as a sleeve the person picks: Use in practice on its card, or practice_settings day_trading. Its share is kept in cash and traded in and out of SPY the same day.",
          practicePortfolioRuns: profile.dayTrade
            ? INTRADAY_RULES[profile.dayTrade.rule].label
            : "no day trading",
          source: INTRADAY_EVIDENCE_SOURCE,
          rules: INTRADAY_RULE_IDS.map((id) => {
            const r = INTRADAY_EVIDENCE[id];
            return {
              rule: INTRADAY_RULES[id].label,
              how: INTRADAY_RULES[id].how,
              setting: `${r.param} (${INTRADAY_RULES[id].param})`,
              since2024YearlyPercent: pct(r.later.cagr),
              since2024WorstDropPercent: pct(r.later.maxDrawdown),
              since2024Trades: r.later.trades,
              since2024WinRatePercent: pct(r.later.winRate),
              holdingSince2024YearlyPercent: pct(r.holdLater.cagr),
              holdingSince2024WorstDropPercent: pct(r.holdLater.maxDrawdown),
              moreReturnForItsRiskThanHolding: r.beatsHolding,
            };
          }),
        },
        strategies: MENU_STRATEGY_IDS.map((id) => {
          const r = MENU_EVIDENCE[id][level];
          return {
            strategy: MENU_STRATEGIES[id].label,
            what: MENU_STRATEGIES[id].line,
            how: MENU_STRATEGIES[id].how,
            yearlyPercent: pct(r.cagr),
            mixYearlyPercent: pct(r.mixCagr),
            worstDropPercent: pct(r.maxDrawdown),
            mixWorstDropPercent: pct(r.mixMaxDrawdown),
            sinceDate2022YearlyPercent: pct(r.laterCagr),
            mixSince2022YearlyPercent: pct(r.mixLaterCagr),
            moreReturnForItsRiskThanTheMix: r.sortino > r.mixSortino,
            fitsLevels: ([1, 2, 3, 4, 5] as const)
              .filter((l) => MENU_EVIDENCE[id][l].fits)
              .map((l) => RISK_LEVELS[l].label),
          };
        }),
      });
    }
    case "news_themes": {
      if (!(await adviceMode(userId, { client }))) return out({ note: PRACTICE_ONLY_NOTE });
      return out({
        label: DEMO_ADVICE_LABEL,
        source: THEME_EVIDENCE_SOURCE,
        notAForecast: "A replay of past events, not a forecast.",
        sliceByLevel: Object.fromEntries(
          Object.entries(THEME_SLICE_BY_LEVEL).map(([l, share]) => [
            RISK_LEVELS[Number(l) as RiskLevel].label,
            `${Math.round((share ?? 0) * 100)}% of the practice portfolio at most`,
          ]),
        ),
        exit: `Out after ${THEME_HOLD_DAYS} trading days, or sooner if it falls ${Math.round(THEME_STOP_LOSS * 100)}% from the buy.`,
        themes: THEME_IDS.map((id) => {
          const r = THEME_EVIDENCE[id];
          return {
            theme: THEMES[id].label,
            fund: `${THEMES[id].ticker}: ${THEMES[id].fund}`,
            what: THEMES[id].what,
            risk: THEMES[id].risk,
            offered: r.heldUp,
            confidencePercent: r.heldUp ? themeConfidence(r) : null,
            pastEvents: r.events,
            beatTheMarket: r.hits,
            averageAgainstTheMarketPoints: Math.round(r.averageExcess * 1000) / 10,
            worstPercent: Math.round(r.worst * 1000) / 10,
            alsoTested: THEME_ALTERNATIVE_EVIDENCE.filter((a) => a.theme === id).map(
              (a) => `${a.ticker}: beat the market in ${a.hits} of ${a.events}`,
            ),
          };
        }),
      });
    }
    case "crypto": {
      const view = await loadCrypto(userId, { client, now });
      return out({
        connections: view.connections.map((c) => ({
          name: c.name,
          kind: c.kind,
          source: c.source,
          asOf: c.asOf?.toISOString() ?? null,
          outOfDate: c.stale,
          total: money(c.totalCents),
        })),
        assets: view.holdings.map((h) => ({
          asset: h.asset,
          name: h.name,
          amount: h.quantity,
          price: money(h.priceCents),
          value: money(h.valueCents),
        })),
        total: money(view.size.totalCents),
        shareOfInvested: Math.round(view.size.share * 1000) / 10,
        flags: view.advice
          ? {
              shareAboveRuleOfThumb: view.size.overShare,
              fees: view.fees && {
                paid: money(view.fees.feesCents),
                traded: money(view.fees.tradedCents),
                percent: view.fees.bps === null ? null : view.fees.bps / 100,
                costly: view.fees.flag,
              },
            }
          : "advice only in demo advice mode",
        trading: "never: Jane has no way to buy, sell or move crypto",
      });
    }
    case "company_stock": {
      const view = await loadCompanyStock(userId, { client, now });
      return out({
        company: view.company,
        ticker: view.ticker,
        held: view.holdings.map((h) => ({
          account: h.accountName,
          shares: h.quantity,
          value: money(h.valueCents),
        })),
        stillToVest: view.grants.map((g) => ({
          kind: g.kind,
          shares: g.unvestedShares,
          everyMonths: g.everyMonths,
          sharesEachTime: g.sharesPerVest,
          nextVest: g.nextVestOn,
        })),
        shareOfInvested: Math.round(view.concentration.share * 1000) / 10,
        shareWithUnvested: Math.round(view.concentration.shareWithUnvested * 1000) / 10,
        overTheLimit: view.concentration.overLimit,
        plan: !view.advice
          ? "advice only in demo advice mode"
          : view.plan && {
              account: view.plan.accountName,
              sellInAll: money(view.plan.sellCents),
              estimatedTax: money(view.plan.taxCents),
              shareAfter: Math.round(view.plan.shareAfter * 1000) / 10,
              costOfAHalfDropBefore: money(view.plan.dropBeforeCents),
              costOfAHalfDropAfter: money(view.plan.dropAfterCents),
              parts: view.plan.parts.map((p) => ({
                on: p.on,
                sell: money(p.proceedsCents),
                gain: money(p.gainCents),
                estimatedTax: money(p.taxCents),
              })),
            },
        taxRatesFromTheTaxEstimate: view.rates.fromEstimate,
      });
    }
    case "hsa": {
      const view = await loadHsa(userId, { client, now });
      return out({
        account: view.account && {
          name: view.account.name,
          balance: money(view.account.balanceCents),
        },
        cover: view.coverage,
        plan: view.plan && {
          cash: money(view.plan.cashCents),
          invested: money(view.plan.investedCents),
          cushion: money(view.plan.cushionCents),
          beyondTheCushion: view.advice
            ? money(view.plan.toInvestCents)
            : "advice only in demo advice mode",
          limitThisYear: money(view.plan.limitCents),
          roomLeft: money(view.plan.roomCents),
          perPaycheck: money(view.plan.perPaycheckCents),
        },
        receiptsVault: {
          saved: money(view.savedCents),
          receipts: view.receipts.slice(0, 10).map((r) => ({
            date: r.date,
            merchant: r.merchant,
            amount: money(r.amountCents),
            status: r.status,
          })),
        },
      });
    }
    case "explainer": {
      const slug =
        (input && typeof input === "object" ? (input as { slug?: unknown }).slug : null) ?? "";
      const e = typeof slug === "string" ? explainer(slug) : null;
      if (!e)
        return out({
          error: "There's no explainer with that name.",
          have: EXPLAINERS.map((x) => x.slug),
        });
      return out({
        title: e.title,
        summary: e.summary,
        text: e.paragraphs,
        sources: e.sources,
        review: REVIEW_NOTE,
        page: `/learn/${e.slug}`,
      });
    }
    default:
      return { content: JSON.stringify({ error: `There's no tool called ${name}.` }), cents: [] };
  }
}
