import { PRACTICE_UNIVERSE } from "@/config/portfolios";
import {
  parsePracticeIdeaId,
  PRACTICE_HREF,
  PRACTICE_IDEA_DAYS,
  PRACTICE_SETTINGS_HREF,
  PRACTICE_TOPIC,
} from "@/config/practice-suggestions";
import { SCAN_LABELS, type ScanKind } from "@/config/practice-scan";
import type { WorthKind } from "@/detectors/contract";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { marketData } from "@/lib/market";
import { positionValue } from "@/planning/practice-autopilot";
import { refusedByPreferences } from "@/planning/practice-profile";
import type { PracticeIdea } from "@/profile/build";
import { loadLedger, NoPracticePortfolio, practiceBroker } from "./broker";
import { practiceProfileOf } from "./preferences";
import { tradesHeldBy } from "./limits";

// The practice scan's ideas as suggestions (Phase AW, Stage A). The scan keeps a flag as
// "suggested" when the person is in suggest-only mode or the kind only suggests; here those
// are read for the detectors (src/detectors/practice-ideas.ts), and the person's answer to the
// suggestion comes back: Yes places the idea's trades in the PRACTICE ledger only (checked
// against the caps again first) or, for an idea without trades, opens the settings; No puts it
// away. Nothing here touches a real account, and nothing happens outside demo advice mode.

type Options = { client?: PrismaClient; now?: Date };

type StoredDetails = {
  figures?: { label: string; value: string }[];
  caps?: string[];
  confidence?: { percent: number; reason: string };
  ask?: { headline: string; short: string; worthCents: number; worthKind: WorthKind };
  trades?: { ticker: string; side: "buy" | "sell"; amountCents: number }[];
};

const DAY_MS = 86_400_000;
const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The ideas waiting for the person, newest first.
export async function openPracticeIdeas(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<PracticeIdea[]> {
  const rows = await scopedFor(userId, client).practiceOpportunities.findMany({
    where: {
      status: "suggested",
      scannedAt: { gte: new Date(now.getTime() - PRACTICE_IDEA_DAYS * DAY_MS) },
    },
    orderBy: [{ scannedAt: "desc" }, { key: "asc" }],
  });
  return rows.flatMap((r) => {
    const d = r.details as StoredDetails;
    if (!d.ask || !(r.kind in PRACTICE_TOPIC)) return [];
    return [
      {
        key: r.key,
        kind: r.kind,
        scannedAt: r.scannedAt.toISOString(),
        label: SCAN_LABELS[r.kind as ScanKind],
        headline: d.ask.headline,
        short: d.ask.short,
        worthCents: d.ask.worthCents,
        worthKind: d.ask.worthKind,
        figures: d.figures ?? [],
        caps: d.caps ?? [],
        confidence: d.confidence ?? { percent: r.confidence, reason: "the scan's rule" },
        trades: d.trades?.length ?? 0,
      },
    ];
  });
}

export type IdeaAnswer = { note: string; href: string };

// The person's answer to a practice idea's suggestion. Null when the key isn't a practice idea.
export async function answerPracticeIdea(
  userId: string,
  suggestionKey: string,
  answer: "yes" | "no",
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<IdeaAnswer | null> {
  const parsed = parsePracticeIdeaId(suggestionKey);
  if (!parsed) return null;
  const db = scopedFor(userId, client);
  const row = await db.practiceOpportunities.findFirst({ where: { key: parsed.opportunityKey } });
  if (!row || row.status !== "suggested") {
    return { note: "That practice idea has already moved on.", href: PRACTICE_HREF };
  }
  if (answer === "no") {
    await db.practiceOpportunities.updateMany({
      where: { id: row.id },
      data: { status: "declined" },
    });
    return { note: "OK, I'll put that practice idea away.", href: PRACTICE_HREF };
  }
  const stored = (row.details as StoredDetails).trades ?? [];
  if (stored.length === 0) {
    await db.practiceOpportunities.updateMany({
      where: { id: row.id },
      data: { status: "accepted" },
    });
    return {
      note: "Good. Your practice settings are where you change it.",
      href: PRACTICE_SETTINGS_HREF,
    };
  }
  if (!(await adviceMode(userId, { client }))) {
    return { note: "Practice ideas are for the demo bank only.", href: PRACTICE_HREF };
  }
  let ledger;
  try {
    ledger = await loadLedger(userId, client);
  } catch (error) {
    if (error instanceof NoPracticePortfolio) {
      return { note: "Start a practice portfolio first.", href: PRACTICE_HREF };
    }
    throw error;
  }
  if (ledger.portfolio.paused) {
    return { note: "Your practice portfolio is paused, so nothing was done.", href: PRACTICE_HREF };
  }
  const asOf = now.toISOString().slice(0, 10);
  const feed = marketData();
  const prices: Record<string, number> = {};
  for (const ticker of PRACTICE_UNIVERSE) {
    const bar = await feed.latest(ticker, asOf);
    if (bar) prices[ticker] = bar.closeCents;
  }
  const tradesToday = await db.practiceTrades.count({
    where: {
      portfolioId: ledger.portfolio.id,
      side: { in: ["buy", "sell"] },
      undone: false,
      placedAt: { gte: new Date(`${asOf}T00:00:00Z`) },
    },
  });
  // The idea may be days old: a sale is never more than is held at today's prices, and the
  // whole idea shrinks with it (a swap stays a like-for-like swap).
  const sellable = Math.min(
    1,
    ...stored
      .filter((t) => t.side === "sell")
      .map((t) => positionValue(ledger.state, prices, t.ticker) / t.amountCents),
  );
  const trades = stored.map((t) => ({ ...t, amountCents: Math.floor(t.amountCents * sellable) }));
  // The never-buy list as it stands now (the person's Yes is the go-ahead, even in suggest-only
  // mode), then the caps again, on today's ledger and prices.
  const profile = await practiceProfileOf(userId, { client, now });
  const held =
    trades
      .map((t) => refusedByPreferences({ ...profile, trades: true }, t))
      .find((r) => r !== null) ?? tradesHeldBy(trades, ledger.state, prices, tradesToday);
  if (held) {
    await db.practiceOpportunities.updateMany({ where: { id: row.id }, data: { status: "held" } });
    return { note: `A cap stopped it (${held}), so nothing was done.`, href: PRACTICE_HREF };
  }
  // Claimed before trading, so two taps act once.
  const { count } = await db.practiceOpportunities.updateMany({
    where: { id: row.id, status: "suggested" },
    data: { status: "acted" },
  });
  if (count === 0) return { note: "That practice idea has already moved on.", href: PRACTICE_HREF };
  const broker = practiceBroker();
  const tradeIds: string[] = [];
  for (const t of [...trades].sort((a, b) =>
    a.side === b.side ? 0 : a.side === "sell" ? -1 : 1,
  )) {
    const fill = await broker.placeOrder(
      userId,
      { ...t, reason: `You said yes: ${row.reason}`, rule: row.kind },
      { client, now },
    );
    tradeIds.push(fill.tradeId);
  }
  await db.practiceOpportunities.updateMany({ where: { id: row.id }, data: { tradeIds } });
  const what = trades
    .map((t) => `${t.side === "buy" ? "bought" : "sold"} ${dollars(t.amountCents)} of ${t.ticker}`)
    .join(", ");
  return {
    note: `Done in your practice portfolio: ${what}. Practice money only: nothing real was bought or sold.`,
    href: PRACTICE_HREF,
  };
}
