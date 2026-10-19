import type { PrismaClient } from "@/generated/prisma/client";
import { loadInvestments } from "@/lib/investments/holdings";
import type { Reply } from "../replies";
import type { InvestmentIntent } from "./intents";
import { profileOf } from "@/lib/investments/profile";
import { adviceMode } from "@/lib/advice-mode";
import { loadFees } from "@/lib/investments/fees";
import { loadReview } from "@/lib/investments/review";
import { feesReply, holdingsReply, profileReply, reviewReply } from "./replies";

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
    case "review": {
      const [{ investments, profile, review }, advice] = await Promise.all([
        loadReview(userId, { client, now }),
        adviceMode(userId, { client }),
      ]);
      return reviewReply(investments, profile, review, advice);
    }
  }
}
