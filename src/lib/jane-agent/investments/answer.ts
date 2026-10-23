import type { PrismaClient } from "@/generated/prisma/client";
import { loadInvestments } from "@/lib/investments/holdings";
import type { Reply } from "../replies";
import type { InvestmentIntent } from "./intents";
import { profileOf } from "@/lib/investments/profile";
import { adviceMode } from "@/lib/advice-mode";
import { loadFees } from "@/lib/investments/fees";
import { loadAccountPlan } from "@/lib/investments/accounts";
import { loadReturns } from "@/lib/investments/returns";
import { loadGoalBuckets } from "@/lib/investments/goal-buckets";
import { estimateCollege, loadCollege } from "@/lib/investments/college";
import { collectReceipts, loadHsa } from "@/lib/investments/hsa";
import { loadCompanyStock } from "@/lib/investments/company-stock";
import { loadCrypto } from "@/lib/crypto/crypto";
import { loadCash } from "@/lib/investments/cash";
import { loadRetirementAccounts } from "@/lib/investments/retirement-accounts";
import { loadOldAccounts } from "@/lib/investments/old-accounts";
import { loadRetirementIncome } from "@/lib/investments/retirement-income";
import { loadFamily } from "@/lib/investments/family";
import { loadProperty } from "@/lib/investments/property";
import { loadCostlyProducts } from "@/lib/investments/costly-products";
import { loadLocation } from "@/lib/investments/location";
import { loadPlanMenu } from "@/lib/investments/plan-menu";
import { loadHonest } from "@/lib/investments/honest";
import { loadShortTerm } from "@/lib/investments/short-term";
import { familyFileReply } from "./family-file-copy";
import { loadFamilyFile } from "@/lib/investments/family-file";
import { loadValues } from "@/lib/investments/values";
import { loadSuddenMoney } from "@/lib/investments/sudden-money";
import { loadSteadyHand } from "@/lib/investments/steady-hand";
import { autopilotOf } from "@/lib/autopilot";
import { autopilotFor } from "@/lib/sector-autopilot";
import { loadInvestmentSnapshot } from "./snapshot";
import { loadAutoInvest } from "@/lib/investments/auto-invest";
import { loadRebalance } from "@/lib/investments/rebalance";
import { loadRetirement } from "@/lib/investments/retirement";
import { profileSummary } from "@/planning/investor-profile";
import { loadReview } from "@/lib/investments/review";
import { backtestsFor } from "@/lib/investments/backtest";
import { latestStrategies } from "@/lib/investments/strategy-eval";
import { practiceProfileOf } from "@/lib/practice/preferences";
import { PRACTICE_LOG_DAYS } from "@/config/practice-cards";
import { setPaused, tradeLog } from "@/lib/practice/autopilot";
import { loadPractice } from "@/lib/practice/portfolio";
import {
  backtestReply,
  levelStrategyReply,
  practiceLogReply,
  practicePauseReply,
} from "./practice-copy";
import {
  accountsReply,
  autoInvestReply,
  autopilotReply,
  overviewReply,
  returnsReply,
  goalBucketsReply,
  collegeReply,
  hsaReply,
  companyStockReply,
  cryptoReply,
  cashReply,
  steadyReply,
  suddenMoneyReply,
  shortTermReply,
  valuesReply,
  honestReply,
  planMenuReply,
  locationReply,
  yearlyReviewReply,
  costlyReply,
  propertyReply,
  familyReply,
  retirementIncomeReply,
  oldAccountsReply,
  retirementAccountsReply,
  feesReply,
  holdingsReply,
  profileReply,
  rebalanceReply,
  retirementReply,
  reviewReply,
} from "./replies";

// Rule answers to investment questions (spec step 128 on), loaded with the same code as
// the investments page and scoped to the person.

export async function answerInvestments(
  userId: string,
  intent: InvestmentIntent,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  const asOf = now.toISOString().slice(0, 10);
  switch (intent.topic) {
    // Spec step 297: the practice portfolio (practice money only, demo advice).
    case "practice_log": {
      const advice = await adviceMode(userId, { client });
      const view = advice ? await loadPractice(userId, { client, now }) : null;
      const since = now.getTime() - PRACTICE_LOG_DAYS * 86_400_000;
      const log = view ? await tradeLog(userId, { client }) : [];
      const week = log.filter((t) => !t.undone && t.placedAt.getTime() >= since);
      return practiceLogReply(view, week, advice, intent.explain ?? false);
    }
    case "practice_pause":
    case "practice_resume": {
      const which = intent.which ?? "all";
      const advice = await adviceMode(userId, { client });
      const view = advice ? await loadPractice(userId, { client, now }) : null;
      if (!view) return practicePauseReply("none", which, advice);
      const pausing = intent.topic === "practice_pause";
      const already = which === "all" ? view.paused : view.opportunitiesPaused;
      if (already === pausing) {
        return practicePauseReply(pausing ? "already_paused" : "already_running", which, true);
      }
      await setPaused(userId, which, pausing, { client });
      return practicePauseReply(pausing ? "paused" : "resumed", which, true);
    }
    case "level_strategy": {
      const [advice, latest] = await Promise.all([
        adviceMode(userId, { client }),
        latestStrategies({ client }),
      ]);
      const level = intent.level ?? (await practiceProfileOf(userId, { client, now })).level;
      return levelStrategyReply(advice, latest, level, intent.level === undefined);
    }
    case "backtest": {
      const data = await backtestsFor(userId, { client, now });
      return backtestReply(data, intent.level ?? null, intent.year ?? null);
    }
    case "holdings":
      return holdingsReply(await loadInvestments(userId, { client, now }), intent.account);
    case "profile":
      return profileReply(await profileOf(userId, { client }), asOf);
    case "fees": {
      const [{ fees }, advice] = await Promise.all([
        loadFees(userId, { client, now }),
        adviceMode(userId, { client }),
      ]);
      return feesReply(fees, advice);
    }
    case "retirement": {
      const [data, advice] = await Promise.all([
        loadRetirement(userId, { client, now }),
        adviceMode(userId, { client }),
      ]);
      return retirementReply(data, advice);
    }
    case "overview": {
      const snapshot = await loadInvestmentSnapshot(userId, { client, now });
      return overviewReply(snapshot);
    }
    case "college": {
      const [{ advice, plans }, estimate] = await Promise.all([
        loadCollege(userId, { client, now }),
        intent.childAge === undefined
          ? Promise.resolve(null)
          : estimateCollege(
              userId,
              { childAge: intent.childAge, type: intent.collegeType ?? "public" },
              { client },
            ),
      ]);
      return collegeReply(advice, estimate, plans.length);
    }
    case "hsa":
      await collectReceipts(userId, { client, now });
      return hsaReply(await loadHsa(userId, { client, now }));
    case "retirement_accounts":
      return retirementAccountsReply(await loadRetirementAccounts(userId, { client, now }));
    case "old_accounts":
      return oldAccountsReply(await loadOldAccounts(userId, { client, now }));
    case "retirement_income":
      return retirementIncomeReply(await loadRetirementIncome(userId, { client, now }));
    case "family":
      return familyReply(await loadFamily(userId, { client, now }));
    case "property":
      return propertyReply(await loadProperty(userId, { client, now }));
    case "costly_products":
      return costlyReply(await loadCostlyProducts(userId, { client, now }));
    case "yearly_review": {
      const snapshot = await loadInvestmentSnapshot(userId, { client, now });
      return yearlyReviewReply(snapshot, now.getUTCFullYear());
    }
    case "location":
      return locationReply(await loadLocation(userId, { client, now }));
    case "plan_menu":
      return planMenuReply(await loadPlanMenu(userId, { client, now }));
    case "honest_performance":
      return honestReply(await loadHonest(userId, { client, now }));
    case "family_file":
      return familyFileReply(await loadFamilyFile(userId, { client }));
    case "values":
      return valuesReply(await loadValues(userId, { client, now }));
    case "short_term":
      return shortTermReply(await loadShortTerm(userId, { client, now }));
    case "sudden_money":
      return suddenMoneyReply(await loadSuddenMoney(userId, { client, now }));
    case "steady":
      return steadyReply(await loadSteadyHand(userId, { client, now }));
    case "cash":
      return cashReply(await loadCash(userId, { client, now }));
    case "crypto":
      return cryptoReply(await loadCrypto(userId, { client, now }));
    case "company_stock":
      return companyStockReply(await loadCompanyStock(userId, { client, now }), asOf);
    case "goals":
      return goalBucketsReply(await loadGoalBuckets(userId, { client, now }));
    case "returns":
      return returnsReply(await loadReturns(userId, { client, now }));
    case "autopilot":
      return autopilotReply(
        await autopilotOf(userId, { client }),
        await autopilotFor(userId, "investing", { client, now }),
      );
    case "accounts":
      return accountsReply(await loadAccountPlan(userId, { client, now }));
    case "auto_invest":
      return autoInvestReply(await loadAutoInvest(userId, { client, now }));
    case "rebalance": {
      const [{ advice, plan }, answers] = await Promise.all([
        loadRebalance(userId, { client, now }),
        profileOf(userId, { client }),
      ]);
      return rebalanceReply(advice, plan, profileSummary(answers, asOf));
    }
    case "review": {
      const [{ investments, profile, review }, advice] = await Promise.all([
        loadReview(userId, { client, now }),
        adviceMode(userId, { client }),
      ]);
      return reviewReply(investments, profile, review, advice);
    }
  }
}
