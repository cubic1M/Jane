import { sinceStatementNote } from "@/planning/since-statement";
import { loadInvestingLeak } from "@/lib/investments/leak";
import type { PrismaClient } from "@/generated/prisma/client";
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
import { READ_ONLY_INVESTMENTS } from "@/config/read-only-beta";
import { conciergeMode } from "@/lib/concierge-mode";
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
import { INTRADAY_AGENT_EVIDENCE } from "@/config/intraday-agent-evidence";
import { AGENT_INTERVALS, AGENT_MARKETS } from "@/config/trading-agent";
import { loadAgentView } from "@/lib/trading-agent/agent";
import { VERDICT_WORDS, type EvidenceRow } from "@/planning/trading-agent/report";
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
import { CATALOG_EVIDENCE, CATALOG_EVIDENCE_SOURCE } from "@/config/catalog-evidence";
import { CATALOG_REGIME_EVIDENCE } from "@/config/catalog-regimes";
import { CATALOG, CATALOG_IDS, CATALOG_WALK_FROM_YEAR } from "@/config/strategy-catalog";
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
import { formatExpenseRatio } from "@/lib/percent";
import { scopedFor } from "@/lib/db-scoped";
import { chatToday } from "@/lib/today";
import { toolAnswer } from "@/lib/ask/tools";
import { loadProfile } from "@/lib/profile";

// Runs Claude's investment tools in Jane's chat (./tools.ts lists them): read-only, scoped
// to the person, and every dollar figure recorded for the guardrails.

export async function runInvestmentTool(
  userId: string,
  name: string,
  input: unknown,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<ToolOutput> {
  const { money, out } = toolAnswer();

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
            yearlyCost: h.expenseRatioBps === null ? null : formatExpenseRatio(h.expenseRatioBps),
            source: h.source,
          })),
        })),
      });
    }
    case "investor_profile": {
      const summary = profileSummary(
        await profileOf(userId, { client }),
        await chatToday(userId, { client, now }),
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
          yearlyCost: formatExpenseRatio(f.expenseRatioBps),
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
              itsYearlyCost: formatExpenseRatio(e.expenseRatioBps),
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
    case "investing_leak": {
      const leak = await loadInvestingLeak(userId, { client });
      return out({
        lostEachYear: money(leak.totalCents),
        parts: leak.parts.map((p) => ({ what: p.label, aYear: money(p.cents) })),
        note: "Each part is one of Jane's ideas, counted once; checking and savings cash is on the money page.",
      });
    }
    case "investments_overview": {
      const [snapshot, level, investing, actsForYou] = await Promise.all([
        loadInvestmentSnapshot(userId, { client, now }),
        autopilotOf(userId, { client }),
        autopilotFor(userId, "investing", { client, now }),
        conciergeMode(userId, { client }),
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
        whatJaneDoesByHerself: actsForYou
          ? investmentsByHerself(level, investing)
          : READ_ONLY_INVESTMENTS.lines,
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
          putIn: l.usedCents === 0 ? "none seen yet" : money(l.usedCents),
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
          // Already claimed: the deposits coming in now, a month.
          monthlyNow:
            v.ss.source === "deposits" && v.ss.fullMonthlyCents !== null
              ? money(v.ss.fullMonthlyCents)
              : null,
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
              spendingFrom: v.spendFrom,
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
      const review = reviewFor(
        snapshot,
        Number((await chatToday(userId, { client, now })).slice(0, 4)),
      );
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
          // Checking walked forward from a statement: say it's an estimate, with the note.
          ...(p.today
            ? {
                balanceToday: money(p.today.cents),
                estimated: true,
                note: `Estimated: ${sinceStatementNote(p.today.since)}. Say "estimated" with it.`,
              }
            : {}),
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
        tested: (() => {
          const rows = CATALOG_IDS.flatMap((id) => {
            const e = CATALOG_EVIDENCE[id]?.[level];
            return e ? [{ id, strategy: CATALOG[id].label, e }] : [];
          });
          return {
            source: CATALOG_EVIDENCE_SOURCE,
            how: `Every strategy in the catalog (docs/backtests/strategy-catalog.md), walk-forward against the level's mix since ${CATALOG_WALK_FROM_YEAR} after costs, recommendable only if it beat the mix after a haircut for testing them all at once (the deflated Sharpe ratio).`,
            practicePortfolioFollows: profile.catalog
              ? CATALOG[profile.catalog.id].label
              : "the level's mix (or Jane's pick)",
            canFollow:
              "A worth-watching or recommendable one can be followed in practice instead of the mix: Use in practice on its card, or practice_settings catalog_strategy.",
            recommendable: rows
              .filter((r) => r.e.recommendable)
              .map((r) => ({
                strategy: r.strategy,
                yearlyPercent: pct(r.e.cagr),
                mixYearlyPercent: pct(r.e.mixCagr),
                worstDropPercent: pct(r.e.maxDrawdown),
                realEdgePercent: Math.round(r.e.dsr * 100),
              })),
            worthWatching: rows
              .filter((r) => r.e.watch)
              .map((r) => ({
                strategy: r.strategy,
                yearlyPercent: pct(r.e.cagr),
                mixYearlyPercent: pct(r.e.mixCagr),
                realEdgePercent: Math.round(r.e.dsr * 100),
                // Descriptive: at its published setting, through each past regime.
                pastRegimes: (CATALOG_REGIME_EVIDENCE[r.id]?.[level] ?? []).map((g) => ({
                  regime: g.label,
                  percent: g.strategy === null ? null : pct(g.strategy),
                  mixPercent: g.mix === null ? null : pct(g.mix),
                })),
              })),
            notRecommended: rows
              .filter((r) => !r.e.recommendable && !r.e.watch)
              .map((r) => ({ strategy: r.strategy, why: r.e.why })),
          };
        })(),
        dayTrading: {
          forLevels: "Very high only, a small sleeve, in and out of SPY the same day",
          warning: INTRADAY_WARNING,
          inThePracticePortfolio:
            "Not offered: every rule lost money after costs, while simply holding SPY made far more. Shown as tested evidence only.",
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
      });
    }
    case "trading_agent": {
      if (!(await adviceMode(userId, { client }))) return out({ note: PRACTICE_ONLY_NOTE });
      const [agent, paper] = await Promise.all([
        loadAgentView(userId, { client }),
        scopedFor(userId, client).paperAccounts.findUnique({
          where: { userId },
          select: { id: true },
        }),
      ]);
      const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
      const row = (r: EvidenceRow) => ({
        strategy: r.label,
        key: r.key,
        yearlyGrowth: pct(r.cagr),
        justHolding: pct(r.holdCagr),
        worstDrop: pct(r.maxDrawdown),
        verdict: VERDICT_WORDS[r.verdict],
      });
      return out({
        simulatedOnly: "Simulated money: nothing real is ever bought or sold.",
        paperAccount: paper ? "started" : "not started (the investments page starts one)",
        agent: agent
          ? {
              strategy: agent.label,
              every: agent.intervalLabel,
              market: agent.marketLabel,
              caughtUpTo: agent.lastBarAt,
              prices: agent.prices === "sample" ? "sample prices (not real)" : "real prices",
              replay: agent.evidence ? row(agent.evidence) : null,
              latestTrades: agent.trades.slice(0, 10).map((t) => ({
                at: t.at,
                trade: `${t.side} ${t.ticker}`,
                amount: money(t.amountCents),
                price: money(t.priceCents),
                fees: money(t.feeCents + t.spreadCents),
                why: t.reason,
              })),
            }
          : null,
        replay: INTRADAY_AGENT_EVIDENCE.map((g) => ({
          market: AGENT_MARKETS[g.market].label,
          every: AGENT_INTERVALS[g.interval].label,
          scored: `${g.from} to ${g.to}`,
          strategies: g.rows.map(row),
        })),
        note: "A replay of past bars, not a forecast. See docs/backtests/intraday.md.",
      });
    }
    default:
      return { content: JSON.stringify({ error: `There's no tool called ${name}.` }), cents: [] };
  }
}
