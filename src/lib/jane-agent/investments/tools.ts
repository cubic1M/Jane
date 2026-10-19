import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@/generated/prisma/client";
import { formatBps } from "@/insights/investments";
import type { ToolOutput } from "@/lib/ask/tools";
import { GOALS, HORIZONS } from "@/config/investing";
import { adviceMode } from "@/lib/advice-mode";
import { loadFees } from "@/lib/investments/fees";
import { loadInvestments } from "@/lib/investments/holdings";
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
};

export const isInvestmentTool = (name: string) => INVESTMENT_TOOLS.some((t) => t.name === name);

export async function runInvestmentTool(
  userId: string,
  name: string,
  _input: unknown,
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
    default:
      return { content: JSON.stringify({ error: `There's no tool called ${name}.` }), cents: [] };
  }
}
