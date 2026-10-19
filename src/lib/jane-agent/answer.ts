import { AFFORD_USUAL_MONTHS } from "@/config/agent-chat";
import { INSIGHT_MONTHS } from "@/config/insights";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadInsightTransactions } from "@/insights/load";
import { loadAffordNumbers } from "@/lib/afford";
import { autopilotOf } from "@/lib/autopilot";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadDebts } from "@/lib/debts";
import { homeSummary } from "@/lib/home";
import { whatJaneDid } from "@/lib/what-jane-did";
import { debtReply } from "./debt-replies";
import type { Intent } from "./intents";
import { answerInvestments } from "./investments/answer";
import {
  actReply,
  affordReply,
  categoryContext,
  approveAllReply,
  comingUpReply,
  greetingReply,
  helpReply,
  pauseReply,
  safeReply,
  spendingReply,
  undoReply,
  whatDidReply,
  type Reply,
} from "./replies";
import { loadSnapshot } from "./snapshot";

// Answers a typed message by rules (spec step 84): loads only what the intent needs, with
// the same loaders as the pages, all scoped to the person, and words it with ./replies.
// Null when the rules can't answer ("unknown"): that's for Claude, when there's a key.

type Options = { client?: PrismaClient; now?: Date };

export async function answerByRules(
  userId: string,
  intent: Intent,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Reply | null> {
  const asOf = now.toISOString().slice(0, 10);
  switch (intent.kind) {
    case "unknown":
      return null;
    case "help":
      return helpReply();
    case "greeting": {
      if (intent.thanks) return greetingReply(true, null);
      const home = await homeSummary(userId, { client, now });
      return greetingReply(false, home?.safeToSpend ?? null);
    }
    case "afford": {
      const numbers = await loadAffordNumbers(userId, { client, now });
      if (!intent.category) return affordReply(intent, numbers);
      const db = scopedFor(userId, client);
      const [transactions, budgets] = await Promise.all([
        loadInsightTransactions(db, asOf, AFFORD_USUAL_MONTHS + 1),
        db.budgets.findMany({ select: { category: true, amountCents: true } }),
      ]);
      return affordReply(
        intent,
        numbers,
        categoryContext(intent.category, transactions, budgets, asOf),
      );
    }
    case "spending": {
      const transactions = await loadInsightTransactions(
        scopedFor(userId, client),
        asOf,
        INSIGHT_MONTHS,
      );
      return spendingReply(intent, transactions, asOf);
    }
    case "coming_up": {
      const home = await homeSummary(userId, { client, now });
      return comingUpReply(intent, home?.comingUp ?? []);
    }
    case "safe_to_spend": {
      const home = await homeSummary(userId, { client, now });
      return safeReply(home?.safeToSpend ?? null);
    }
    case "what_did":
      return whatDidReply(await whatJaneDid(userId, { client, now }));
    case "act":
      return actReply(intent, await loadSnapshot(userId, { client, now }), now);
    case "approve_all":
      return approveAllReply(await loadSnapshot(userId, { client, now }));
    case "undo":
      return undoReply(await loadSnapshot(userId, { client, now }), now);
    case "pause_autopilot":
      return pauseReply(await autopilotOf(userId, { client }));
    // Loans and debt (spec Phase Y).
    case "debts":
    case "debt_detail":
      return debtReply(intent, await loadDebts(userId, { client, now }));
    case "investments":
      return answerInvestments(userId, intent, { client, now });
  }
}
