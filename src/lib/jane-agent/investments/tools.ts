import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@/generated/prisma/client";
import { formatBps } from "@/insights/investments";
import type { ToolOutput } from "@/lib/ask/tools";
import { GOALS, HORIZONS } from "@/config/investing";
import { adviceMode } from "@/lib/advice-mode";
import { loadFees } from "@/lib/investments/fees";
import { loadInvestments } from "@/lib/investments/holdings";
import { EXPLAINERS, REVIEW_NOTE, explainer } from "@/config/learn";
import { INVESTMENT_AUTOPILOT } from "@/config/investing";
import { autopilotOf } from "@/lib/autopilot";
import { loadInvestmentSnapshot } from "./snapshot";
import { overviewReply } from "./replies";
import { loadAccountPlan } from "@/lib/investments/accounts";
import { loadReturns } from "@/lib/investments/returns";
import { loadGoalBuckets } from "@/lib/investments/goal-buckets";
import { estimateCollege, loadCollege, type CollegeEstimate } from "@/lib/investments/college";
import { loadHsa } from "@/lib/investments/hsa";
import { loadCompanyStock } from "@/lib/investments/company-stock";
import { loadCrypto } from "@/lib/crypto/crypto";
import { loadCash } from "@/lib/investments/cash";
import { loadRetirementAccounts } from "@/lib/investments/retirement-accounts";
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
      "In demo advice mode, once the investor profile is complete: the person's mix (US stocks, international stocks, bonds, cash) against the target for their risk level, which parts are off target and by how much, any one company's shares that are too big a part (and whether it's their employer), idle cash, and what to change with the reason. Never say what returns will be.",
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
        idleCash: money(review.idleCashCents),
        whatToChange: review.recommendations.map((r) => ({
          what: r.what,
          why: r.why,
          amount: money(r.amountCents),
        })),
        leftOut: review.leftOut,
      });
    }
    case "retirement_plan": {
      const [data, advice] = await Promise.all([
        loadRetirement(userId, { client, now }),
        adviceMode(userId, { client }),
      ]);
      if (!advice) return out({ note: "The retirement planner is for demo advice mode only." });
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
      const [snapshot, level] = await Promise.all([
        loadInvestmentSnapshot(userId, { client, now }),
        autopilotOf(userId, { client }),
      ]);
      const note = overviewReply(snapshot);
      const key = (
        level && Object.hasOwn(INVESTMENT_AUTOPILOT, level) ? level : "none"
      ) as keyof typeof INVESTMENT_AUTOPILOT;
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
        whatJaneDoesByHerself: INVESTMENT_AUTOPILOT[key],
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
