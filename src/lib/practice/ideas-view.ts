import { PRACTICE_TOPIC, practiceIdeaId } from "@/config/practice-suggestions";
import { practiceSuggestion } from "@/detectors/practice-ideas";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { answerSuggestion } from "@/lib/suggestions";
import { practiceLearned, type Learned } from "@/planning/practice-learned";
import type { TopicHistory } from "@/planning/suggestion-rank";
import type { PracticeIdea } from "@/profile/build";
import { answerPracticeIdea, openPracticeIdeas, type IdeaAnswer } from "./ideas";
import { practiceProfileOf } from "./preferences";

// The practice portfolio's ideas where the person can see them (Phase AW, Stage A): the ideas
// waiting, each with how sure Jane is; what their answers so far changed; and the strategy the
// autopilot follows today. For the practice page and the chat's practice_portfolio tool. The
// page's Yes and No count as answers to the idea's suggestion, so they move the kind's rank just
// as the chat's do. Practice money and demo advice only.

type Options = { client?: PrismaClient; now?: Date };

export type IdeaWaiting = PracticeIdea & { suggestionKey: string };
export type PracticeStrategyNow = { label: string; key: string; followed: boolean; note: string };
export type PracticeIdeasView = {
  ideas: IdeaWaiting[];
  learned: Learned[];
  strategy: PracticeStrategyNow | null;
};

const PRACTICE_TOPICS: readonly string[] = Object.values(PRACTICE_TOPIC);

// What the person has said to practice ideas, by topic: the history the nightly scan ranks with.
export async function practiceAnswers(
  userId: string,
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<TopicHistory> {
  const rows = await scopedFor(userId, client).suggestions.findMany({
    where: { topic: { in: [...PRACTICE_TOPICS] }, status: { in: ["yes", "no"] } },
    select: { topic: true, status: true },
  });
  const history: Record<string, { yes: number; no: number }> = {};
  for (const r of rows) {
    const h = (history[r.topic] ??= { yes: 0, no: 0 });
    if (r.status === "yes") h.yes += 1;
    else h.no += 1;
  }
  return history;
}

export async function practiceIdeasView(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<PracticeIdeasView> {
  const [ideas, history, profile] = await Promise.all([
    openPracticeIdeas(userId, { client, now }),
    practiceAnswers(userId, { client }),
    practiceProfileOf(userId, { client, now }),
  ]);
  return {
    ideas: ideas.flatMap((i) => {
      const topic = PRACTICE_TOPIC[i.kind as keyof typeof PRACTICE_TOPIC];
      return topic ? [{ ...i, suggestionKey: practiceIdeaId(topic, i.key) }] : [];
    }),
    learned: practiceLearned(history),
    strategy: profile.strategy
      ? {
          label: profile.strategy.label,
          key: profile.strategy.key,
          followed: profile.strategy.followed,
          note: profile.strategy.note,
        }
      : null,
  };
}

// Yes or No on an idea from the practice page. The idea's suggestion is made first when the
// nightly scan hasn't reached it yet, so the answer always counts toward what Jane learns.
// Null when the key isn't one of the person's ideas waiting.
export async function answerIdeaHere(
  userId: string,
  suggestionKey: string,
  answer: "yes" | "no",
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<IdeaAnswer | null> {
  const idea = (await openPracticeIdeas(userId, { client, now })).find((i) => {
    const topic = PRACTICE_TOPIC[i.kind as keyof typeof PRACTICE_TOPIC];
    return topic && practiceIdeaId(topic, i.key) === suggestionKey;
  });
  const s = idea && practiceSuggestion(idea);
  if (!s) return null;
  await client.suggestion.upsert({
    where: { userId_key: { userId, key: s.id } },
    update: {},
    create: {
      userId,
      key: s.id,
      capability: s.capability,
      topic: s.topic,
      title: s.title,
      headline: s.headline,
      short: s.short,
      worthCents: s.worthCents,
      worthKind: s.worthKind,
      confidencePercent: s.confidence.percent,
      confidenceReason: s.confidence.reason,
      urgency: s.urgency,
      why: s.why,
      actionLabel: s.action.label,
      actionHref: s.action.href,
      lastSeenAt: now,
    },
  });
  await answerSuggestion(userId, s.id, answer, { client, now });
  return answerPracticeIdea(userId, s.id, answer, { client, now });
}
