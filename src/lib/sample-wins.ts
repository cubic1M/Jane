import type { PersonId } from "@/config/people";
import { SAMPLE_WINS, type SampleWin } from "@/data-sources/demo/people-extras/wins";
import type { FindingType, Prisma, PrismaClient } from "@/generated/prisma/client";
import { loadAction, setStatus } from "@/lib/agent/action";
import { ACTION_FOR_FINDING, CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { recordDecision } from "@/lib/decisions";
import { partnerForUser } from "@/lib/referrals";
import { DAY_MS } from "@/lib/dates";

// What Jane already did for a sample person (spec step 139, gap audit): each of their past wins
// (src/data-sources/demo/people-extras/wins.ts) goes through the real path, as it would have
// happened: a finding as detection makes it, the person's yes (recordDecision: the decision and
// its action), and the action finished the way the agent finishes it (setStatus), on the days it
// happened. The transactions that prove each win are in the sample data, so /saved confirms
// them from the person's own transactions (src/lib/savings-proof.ts) and saved-to-date counts
// the same (savedToDate). No email goes out for them. Sample people only: real accounts and the
// plain demo bank start at $0.00.

// anchor: the demo bank's own day (src/lib/plaid/demo.ts), the day its transactions count back
// from. The wins count back from the same day, or a win's dates miss the lines that prove it: on
// the person's day, at 9pm in Los Angeles the refund was looked for a day before it came.
type Options = { client?: PrismaClient; anchor: string };

export const SAMPLE_WIN_KEY = "sample-win:";

// Days counted back from the demo bank's day.
const dayOf = (anchor: string, offset: number) =>
  new Date(Date.parse(`${anchor}T00:00:00Z`) + offset * DAY_MS);
const cents = (dollars: number) => Math.round(dollars * 100);

function findingOf(win: SampleWin): {
  type: FindingType;
  title: string;
  annualSavingsCents: number;
  amountCents: number;
  evidence: Prisma.InputJsonObject;
} {
  if (win.kind === "cancelled") {
    const monthly = cents(win.monthlyDollars);
    return {
      type: "subscription_review",
      title: `Review your ${win.merchant} subscription`,
      annualSavingsCents: monthly * 12,
      amountCents: monthly,
      evidence: {
        merchant: win.merchant,
        frequency: "MONTHLY",
        lastAmountCents: monthly,
        annualCostCents: monthly * 12,
        transactions: [],
      },
    };
  }
  return {
    type: "duplicate_charge",
    title: `${win.merchant}: the refund for ${win.what}`,
    annualSavingsCents: cents(win.dollars),
    amountCents: cents(win.dollars),
    evidence: { merchant: win.merchant, totalCents: cents(win.dollars), transactions: [] },
  };
}

// When each step happened: the yes, and the day the action finished.
function datesOf(win: SampleWin, anchor: string) {
  if (win.kind === "cancelled") {
    // Cancelled the day after the last charge's month ran out; confirmed once the next charge
    // didn't come.
    const cancelledOn = dayOf(anchor, -win.stoppedDaysAgo + 1);
    return {
      decided: dayOf(anchor, -win.stoppedDaysAgo - 2),
      finished: dayOf(anchor, -win.stoppedDaysAgo + 35),
      extra: { cancelledOn },
    };
  }
  const seen = dayOf(anchor, -win.refundedDaysAgo);
  return {
    decided: dayOf(anchor, -win.chargedDaysAgo + 1),
    finished: seen,
    extra: { refundCents: cents(win.dollars), refundSeenAt: seen },
  };
}

export async function seedSampleWins(
  userId: string,
  person: PersonId,
  { client = defaultClient, anchor }: Options,
): Promise<number> {
  const wins = SAMPLE_WINS[person] ?? [];
  const db = scopedFor(userId, client);
  if (
    wins.length === 0 ||
    (await db.findings.count({ where: { key: { startsWith: SAMPLE_WIN_KEY } } })) > 0
  ) {
    return 0;
  }
  for (const win of wins) {
    const f = findingOf(win);
    const finding = await db.findings.create({
      data: { userId, key: `${SAMPLE_WIN_KEY}${win.key}`, confidence: "high", ...f },
      select: CARD_SELECT,
    });
    const card = buildCard(
      finding,
      await partnerForUser(userId, ACTION_FOR_FINDING[f.type], { client }),
    );
    const { decisionId, actionId } = await recordDecision(
      userId,
      { findingId: finding.id, choice: "yes", cardHash: cardHash(card) },
      { client },
    );
    if (!actionId) continue;
    const { decided, finished, extra } = datesOf(win, anchor);
    await db.decisions.updateMany({ where: { id: decisionId }, data: { createdAt: decided } });
    await db.actions.updateMany({ where: { id: actionId }, data: { createdAt: decided } });
    const action = await loadAction(userId, actionId, client);
    if (!action) continue;
    await setStatus(
      userId,
      { ...action, startedAt: decided },
      "done",
      { agentState: "finished", ...extra },
      { client, now: finished, notify: async () => {} },
    );
  }
  return wins.length;
}
