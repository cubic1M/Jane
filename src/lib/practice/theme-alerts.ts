import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { PRACTICE_HREF, PRACTICE_TOPIC, practiceIdeaId } from "@/config/practice-suggestions";
import { THEME_ALERT_PRIORITY, THEME_ALERTS_PER_DAY } from "@/config/themes";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import type { PlannedMessage } from "@/lib/jane-agent/brain";
import { postMessages } from "@/lib/jane-agent/messages";
import { queueChatNotificationsSafely } from "@/lib/jane-agent/notify";
import { hasDemoBank } from "@/lib/plaid/demo";
import { practiceCardDetails } from "@/lib/practice/ideas";
import { isTrialUser } from "@/lib/trial-ids";

// A news theme's idea as an alert (Phase AW, Stage A): when the practice scan finds one, Jane
// posts it in the chat as a suggestion, so it comes up as a floating card to decide (why now, the past record and how sure she is, the
// slice, the risk, when it gets out) with Yes and No, then sends what's due as the person set
// their notifications. At most THEME_ALERTS_PER_DAY a day; one card per idea, ever (its
// dedupeKey). A trial or sample person gets the card only, never a push or an email: their
// data is sample data. Demo advice only.

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 86_400_000;
export const THEME_ALERT_SOURCE = "themes";

type StoredDetails = {
  figures?: { label: string; value: string }[];
  confidence?: { percent: number; reason: string };
  ask?: { headline: string; short: string };
};

export async function postThemeAlerts(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  if (!(await adviceMode(userId, { client }))) return 0;
  const db = scopedFor(userId, client);
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const postedToday = await db.janeMessages.count({
    where: { dedupeKey: { startsWith: `${THEME_ALERT_SOURCE}:` }, createdAt: { gt: dayAgo } },
  });
  const room = THEME_ALERTS_PER_DAY - postedToday;
  if (room <= 0) return 0;
  const ideas = await db.practiceOpportunities.findMany({
    where: { kind: "theme_idea", status: "suggested", scannedAt: { gt: dayAgo, lte: now } },
    orderBy: [{ confidence: "desc" }, { scannedAt: "desc" }],
    take: room,
  });
  if (ideas.length === 0) return 0;
  const chatOnly = isTrialUser(userId) || (await hasDemoBank(userId, { client }));
  const keyOf = (row: (typeof ideas)[number]) => practiceIdeaId(PRACTICE_TOPIC.theme_idea, row.key);
  // The same figures, caps and "what Yes does" the floating card shows for every practice idea.
  const extras = await practiceCardDetails(userId, ideas.map(keyOf), { client });
  const planned = ideas.map((row): PlannedMessage => {
    const d = row.details as StoredDetails;
    const fig = (label: string) => d.figures?.find((f) => f.label === label)?.value;
    const percent = d.confidence?.percent ?? row.confidence;
    const key = keyOf(row);
    // A suggestion's short card (the floating cards, src/app/chat/suggestion-cards.tsx): the
    // headline, one "Why you" line, and how sure Jane is; the whole reason behind More details.
    const lines = [
      // Ten words at most, one figure: "News theme: Try $400 of ITA in practice".
      `News theme: ${(d.ask?.headline ?? row.headline).replace(/ on (the )?news,/, "")}`,
      `Why you: ${fig("Why now") ?? row.reason}.`,
      `${percent}% sure: ${d.confidence?.reason ?? "from its past events"}.`,
    ];
    const why = [
      `Why now: ${fig("Why now") ?? row.reason}.`,
      `${fig("Past events") ?? ""}, ${fig("On average against the market") ?? ""} on average over a month.`,
      `The risk: ${fig("The risk") ?? ""}`,
      `${fig("When to get out") ?? ""} Practice money only: nothing real is bought.`,
      DEMO_ADVICE_LABEL,
    ].join(" ");
    const extra = extras.get(key);
    return {
      source: THEME_ALERT_SOURCE,
      kind: "decision",
      body: lines.join("\n"),
      refs: {
        suggestion: key,
        suggestionWhy: why,
        advice: true,
        ...(extra ? { cardDetails: extra } : {}),
        ...(chatOnly ? { chatOnly: true as const } : {}),
      },
      actions: [
        { id: "suggestion.yes" as const, label: "Yes, in practice", kind: "primary" as const },
        { id: "snooze" as const, label: "Not now", kind: "secondary" as const },
        { id: "suggestion.no" as const, label: "No", kind: "secondary" as const },
        { id: "open" as const, label: "See it", kind: "link" as const, href: PRACTICE_HREF },
      ],
      dedupeKey: `${THEME_ALERT_SOURCE}:${row.key}`,
      priority: THEME_ALERT_PRIORITY,
    };
  });
  const posted = await postMessages(userId, planned, { client, now });
  if (posted > 0) await queueChatNotificationsSafely(userId, { client, now, trigger: "cron" });
  return posted;
}

// Never lets an alert fail the practice run.
export async function postThemeAlertsSafely(userId: string, options: Options = {}) {
  try {
    await postThemeAlerts(userId, options);
  } catch (error) {
    console.error("Posting a news theme's alert failed", { error: String(error) });
  }
}
