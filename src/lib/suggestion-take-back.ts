import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { habitKey } from "@/lib/memory/learn";
import type { SuggestionAnswerSnapshot } from "@/lib/jane-agent/types";

// "Don't suggest this again", taken back from the line left where the card was (founder, 11-16).
// A no changes three things (src/lib/suggestions.ts answerSuggestion): the suggestion is never
// offered again, the verified savings record says declined, and Jane's memory counts it as a pass
// on that kind of suggestion. What each was before the no is kept on the message, and taking it
// back puts each back as it was. Every write checks it is still the no's, so a second tap, or an
// answer given since, is left alone.

type Options = { client?: PrismaClient; now?: Date };

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const dateOf = (s: string | null) => (s ? new Date(s) : null);

// What a no is about to change, read just before it.
export async function snapshotBeforeNo(
  userId: string,
  key: string,
  { client = defaultClient }: Options = {},
): Promise<SuggestionAnswerSnapshot | null> {
  const db = scopedFor(userId, client);
  const suggestion = await db.suggestions.findFirst({ where: { key } });
  if (!suggestion) return null;
  const outcome = await db.suggestionOutcomes.findFirst({ where: { suggestionKey: key } });
  const habit = await db.userFacts.findFirst({
    where: { key: habitKey(suggestion.topic), supersededById: null },
    orderBy: [{ lastConfirmed: "desc" }, { id: "desc" }],
  });
  return {
    key,
    topic: suggestion.topic,
    suggestion: { status: suggestion.status, answeredAt: iso(suggestion.answeredAt) },
    outcome: outcome
      ? { status: outcome.status, answer: outcome.answer, answeredAt: iso(outcome.answeredAt) }
      : null,
    habit: habit
      ? {
          id: habit.id,
          value: habit.value as { value: string | number | boolean },
          label: habit.label,
          source: habit.source,
          sourceRef: habit.sourceRef,
          confidence: habit.confidence,
          evidenceCount: habit.evidenceCount,
          lastConfirmed: habit.lastConfirmed.toISOString(),
        }
      : null,
  };
}

// A snapshot read back from a message's refs, or null when it isn't one.
export function asSnapshot(value: unknown): SuggestionAnswerSnapshot | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Partial<SuggestionAnswerSnapshot>;
  if (typeof v.key !== "string" || typeof v.topic !== "string") return null;
  if (typeof v.suggestion?.status !== "string") return null;
  return v as SuggestionAnswerSnapshot;
}

// Puts back what the no changed. Safe to run twice: the second finds nothing that is still the no's.
export async function takeBackNo(
  userId: string,
  snapshot: SuggestionAnswerSnapshot,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const { key } = snapshot;
  await db.suggestions.updateMany({
    where: { key, status: "no" },
    data: {
      status: snapshot.suggestion.status,
      answeredAt: dateOf(snapshot.suggestion.answeredAt),
    },
  });

  if (snapshot.outcome) {
    await db.suggestionOutcomes.updateMany({
      where: { suggestionKey: key, answer: "no" },
      data: {
        status: snapshot.outcome.status,
        answer: snapshot.outcome.answer,
        answeredAt: dateOf(snapshot.outcome.answeredAt),
      },
    });
  } else {
    // The no made the record: it goes with it.
    await db.suggestionOutcomes.deleteMany({ where: { suggestionKey: key, answer: "no" } });
  }

  const ref = `suggestion:${key}`;
  const now = await db.userFacts.findFirst({
    where: { key: habitKey(snapshot.topic), supersededById: null },
    orderBy: [{ lastConfirmed: "desc" }, { id: "desc" }],
  });
  if (!now) return;
  const before = snapshot.habit;
  if (!before || now.id !== before.id) {
    // The no made a new habit row (the first pass, or one that replaced the old): only that one
    // goes, and the one it replaced is what Jane knows again.
    if (now.sourceRef !== ref) return;
    await db.userFacts.deleteMany({ where: { id: now.id } });
    if (before) {
      await db.userFacts.updateMany({
        where: { id: before.id, supersededById: now.id },
        data: { supersededById: null },
      });
    }
    return;
  }
  // The no weakened or confirmed the same row: as it was.
  await db.userFacts.updateMany({
    where: { id: before.id },
    data: {
      value: before.value as Prisma.InputJsonObject,
      label: before.label,
      source: before.source,
      sourceRef: before.sourceRef,
      confidence: before.confidence,
      evidenceCount: before.evidenceCount,
      lastConfirmed: new Date(before.lastConfirmed),
    },
  });
}
