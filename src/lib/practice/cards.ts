import type { RiskLevel } from "@/config/investing";
import { PRACTICE_CARD_DAYS } from "@/config/practice-cards";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import type { FloatingCardData } from "@/lib/floating-cards";
import { opportunityCard, tradeDays, tradesCard } from "@/planning/practice-cards";

// The practice portfolio's cards for the chat (spec step 296): what the daily scan flagged and
// what the autopilot did in the last few days, not yet put away. Practice money only, and only
// in demo advice mode, where the practice portfolio lives.

type Options = { client?: PrismaClient; now?: Date };

// The autopilot's own trades get a card a day; the scan's are on their opportunity's card.
const AUTOPILOT_RULES = ["model_buy", "rebalance"];

export async function practiceCards(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<FloatingCardData[]> {
  if (!(await adviceMode(userId, { client }))) return [];
  const db = scopedFor(userId, client);
  const portfolio = await db.practicePortfolios.findFirst({ select: { level: true } });
  if (!portfolio) return [];
  const since = new Date(now.getTime() - PRACTICE_CARD_DAYS * 86_400_000);
  const [opportunities, trades] = await Promise.all([
    db.practiceOpportunities.findMany({
      // Ideas still waiting for the person (or answered) are suggestions, not cards
      // (src/detectors/practice-ideas.ts): only what was done or held shows here.
      where: {
        scannedAt: { gte: since },
        dismissedAt: null,
        status: { notIn: ["suggested", "declined", "accepted"] },
      },
      orderBy: [{ scannedAt: "desc" }, { id: "desc" }],
    }),
    db.practiceTrades.findMany({
      where: {
        placedAt: { gte: since },
        dismissedAt: null,
        undone: false,
        rule: { in: AUTOPILOT_RULES },
      },
      orderBy: [{ placedAt: "asc" }, { id: "asc" }],
    }),
  ]);
  const level = portfolio.level as RiskLevel;
  return [
    ...opportunities.map(opportunityCard),
    ...tradeDays(trades).map((d) => tradesCard(d.day, level, d.trades)),
  ];
}

// "Got it" (or the pause switch) on a card puts it away for good.
export async function dismissPracticeCard(
  userId: string,
  cardId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const db = scopedFor(userId, client);
  const at = cardId.indexOf(":");
  const kind = cardId.slice(0, at);
  const key = cardId.slice(at + 1);
  if (at < 0) return;
  if (kind === "opportunity" && key) {
    await db.practiceOpportunities.updateMany({ where: { id: key }, data: { dismissedAt: now } });
  } else if (kind === "trades" && /^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const from = new Date(`${key}T00:00:00Z`);
    const to = new Date(from.getTime() + 86_400_000);
    await db.practiceTrades.updateMany({
      where: { placedAt: { gte: from, lt: to }, rule: { in: AUTOPILOT_RULES } },
      data: { dismissedAt: now },
    });
  }
}
