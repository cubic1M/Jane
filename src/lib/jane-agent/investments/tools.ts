import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@/generated/prisma/client";
import { formatBps } from "@/insights/investments";
import type { ToolOutput } from "@/lib/ask/tools";
import { GOALS, HORIZONS } from "@/config/investing";
import { adviceMode } from "@/lib/advice-mode";
import { loadFees } from "@/lib/investments/fees";
import { loadInvestments } from "@/lib/investments/holdings";
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
];

// What the person sees while Jane looks it up.
export const INVESTMENT_TOOL_STATUS: Readonly<Record<string, string>> = {
  holdings: "Looking at what you own…",
  investor_profile: "Checking your investor profile…",
  investment_fees: "Adding up your investment fees…",
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
    default:
      return { content: JSON.stringify({ error: `There's no tool called ${name}.` }), cents: [] };
  }
}
