import type Anthropic from "@anthropic-ai/sdk";
import { EXPLAINERS } from "@/config/learn";
import { noInput } from "@/lib/ask/tools";

// Claude's tools for investment questions in Jane's chat (spec step 128 on): read-only,
// scoped to the person, and every dollar figure recorded for the guardrails. Each later
// investment step adds its tools here; ../claude-tools.ts lists and runs them.

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
    name: "investing_leak",
    description:
      "What the person's investing loses each year, added up once from Jane's own ideas: fund and plan costs, cash waiting inside investment accounts, an employer match not used, tax they could avoid paying (placement and harvesting) and a costly annuity, each in dollars a year. Risks (too much in one stock) and cash in checking and savings (the money page's) are not in it. Facts and estimates from the person's own accounts; never promise a return.",
    input_schema: noInput,
  },
  {
    name: "investments_overview",
    description:
      "How the person's investments stand this month: the total, the change from a month ago (from daily balances, counting what went in), what went in last month, fees a year, whether the mix is on target (demo advice), whether orders are ready, and what Jane does with investments on its own at their autopilot level. Facts about the past only: never say where markets are going.",
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
      "In demo advice mode: each of the person's goals (and retirement) with how far away it is, the mix it's invested in by the glide path (cash under 3 years, safer as the date nears, stocks capped by their risk level), what it needs a month, and whether Jane splits automatic investing's new money by goal on its own at their autopilot level.",
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
      "The yearly investing review in one list: what Jane did on its own within the person's caps and what is waiting for their tap; retirement account room and the employer match; old 401(k)s that could come home; whether the mix has drifted; tax-loss harvesting chances; what investing costs; and every goal with what it still needs. Report it as the list it is; every change is the person's own tap on Jane's message, never something you do.",
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
      "The person's practice portfolio (demo advice mode only): a paper portfolio Jane runs on practice money, never real money, at a risk level (Very low to Very high). Gives the level, what it's worth and started with, cash, each position, whether Jane is paused (all trading, or opportunities only), this week's trades with the rule and the reason for each, the ideas Jane is waiting on the person for (each with how sure Jane is, as a percent, and why), the strategy the autopilot follows today and whether the person's settings let it, and what their yes and no to past ideas changed (which kinds now come sooner or later). For \"what are you thinking of doing\", \"what strategy is mine on\" or \"have you learned what I like\". Say plainly that it's practice money and nothing real was bought or sold. To pause or resume it, offer practice.pause or practice.resume with propose_action; you can't change it yourself.",
    input_schema: noInput,
  },
  // Phase AW: the strategy menu, each replayed at the person's level against their mix.
  {
    name: "strategy_menu",
    description:
      'The strategy menu for the practice portfolio (demo advice mode only): well-known ways to run it besides Jane\'s pick for the person\'s level (value, momentum and quality tilts, dividend growth, equal weight, sector rotation, all-weather risk parity), and at Very high a small crypto sleeve (bitcoin and ether held, or run by a trend or momentum rule, against holding since 2022, with its warning, which the practice portfolio can run as a sleeve at Very high) and day-trading rules on SPY\'s 5-minute bars (an opening-range break, a liquidity sweep of the prior day\'s low, a fair value gap, VWAP reversion, a volume imbalance; each after slippage against holding since 2024, with the warning that most day traders lose money, tested and not offered because every rule lost money after costs), each replayed on real prices after costs at the person\'s level, with how it works, its yearly return and worst drop against the level\'s own mix over the same days (the whole replay and the years since 2022), whether it gave more or less return for its risk, and the levels it fits. For "what other strategies are there", "is momentum better", "how does all-weather work" or "can I day trade", "which strategies did you test" or "is dual momentum any good". Always call it a replay of the past, never a forecast, and say plainly when a strategy did worse than the mix.',
    input_schema: noInput,
  },
  // Phase AW: the news themes the practice portfolio watches, and how each did before.
  {
    name: "news_themes",
    description:
      'The news themes Jane watches for the practice portfolio (demo advice mode only): each kind of event (a Middle East supply shock, a war, a market scare, a Fed rate cut, a chip boom), the fund it points to, and how that fund did on the theme\'s past events against the whole US market over about a month, with the confidence and whether Jane offers it (only the ones that held up are). Also the slice by level and when the idea gets out. For "what do you do when there\'s a war", "should I buy oil" or "what news do you watch". Always call the numbers a replay of the past, never a forecast, and say when a theme didn\'t hold up.',
    input_schema: noInput,
  },
  // The 24-hour agent on the paper account (src/lib/trading-agent/).
  {
    name: "trading_agent",
    description:
      'The 24-hour agent on the paper account (demo advice mode only, simulated money): whether it runs, the strategy, how often (every 15 minutes or every hour) and the market (bitcoin and ether around the clock, or US funds in market hours), the last bar it caught up to, its latest trades each with the time, price, fees and the reason, and how its strategy did in the replay of past bars against just holding. Also every strategy the replay ran for each market and interval, with its yearly growth, worst drop and verdict (beat holding after the haircut, made less than holding, or lost money). For "what is the agent doing", "what did it trade overnight", "which strategy should the agent run" or "do any of these beat holding bitcoin". Always call the figures a replay of the past, never a forecast; say plainly that most of them lost money after costs, and that nothing real is ever bought or sold.',
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
  trading_agent: "Looking at the 24-hour agent…",
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
  investing_leak: "Adding up what your investing costs you…",
};

export const isInvestmentTool = (name: string) => INVESTMENT_TOOLS.some((t) => t.name === name);
