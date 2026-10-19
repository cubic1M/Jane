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
import { autopilotOf } from "@/lib/autopilot";
import { loadInvestmentSnapshot } from "./snapshot";
import { loadAutoInvest } from "@/lib/investments/auto-invest";
import { loadRebalance } from "@/lib/investments/rebalance";
import { loadRetirement } from "@/lib/investments/retirement";
import { profileSummary } from "@/planning/investor-profile";
import { loadReview } from "@/lib/investments/review";
import {
  accountsReply,
  autoInvestReply,
  autopilotReply,
  overviewReply,
  returnsReply,
  goalBucketsReply,
  collegeReply,
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
    case "goals":
      return goalBucketsReply(await loadGoalBuckets(userId, { client, now }));
    case "returns":
      return returnsReply(await loadReturns(userId, { client, now }));
    case "autopilot":
      return autopilotReply(await autopilotOf(userId, { client }));
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
