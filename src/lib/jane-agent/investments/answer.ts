import type { PrismaClient } from "@/generated/prisma/client";
import { loadInvestments } from "@/lib/investments/holdings";
import type { Reply } from "../replies";
import type { InvestmentIntent } from "./intents";
import { holdingsReply } from "./replies";

// Rule answers to investment questions (spec step 128 on), loaded with the same code as
// the investments page and scoped to the person.

export async function answerInvestments(
  userId: string,
  intent: InvestmentIntent,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  const data = await loadInvestments(userId, { client, now });
  switch (intent.topic) {
    case "holdings":
      return holdingsReply(data, intent.account);
  }
}
