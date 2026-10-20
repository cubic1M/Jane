import { QUESTIONS, type QuestionSpec } from "@/config/questions";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { correctFact, loadProfileInput } from "@/lib/profile";
import { buildProfile } from "@/profile/build";
import { bestQuestion } from "@/profile/questions";

// The one question worth asking (spec step 257): when a detector could fire but needs a fact
// the profile doesn't have, Jane asks the question whose answer unlocks the most, one at a
// time, once. The answer goes into the profile (through the same path as a correction on
// /profile), so every reader sees it. A question that was answered or skipped is never asked
// again.

type Options = { client?: PrismaClient; now?: Date };

const ASKED = "asked:";

export type OpenQuestion = {
  fact: string;
  text: string;
  choices: QuestionSpec["choices"];
  unlockCents: number;
};

async function askedFacts(userId: string, client: PrismaClient): Promise<Set<string>> {
  const rows = await scopedFor(userId, client).janePreferences.findMany({
    where: { kind: "system", key: { startsWith: ASKED } },
    select: { key: true },
  });
  return new Set(rows.map((r) => r.key.slice(ASKED.length)));
}

// The question to ask now, or null: none worth asking, or one is already waiting for an
// answer (one at a time).
export async function nextQuestion(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<OpenQuestion | null> {
  const db = scopedFor(userId, client);
  const posted = await db.janeMessages.findMany({
    where: { dedupeKey: { startsWith: "questions:" } },
    select: { dedupeKey: true, status: true },
  });
  if (posted.some((m) => m.status === "open")) return null;
  const [data, answered] = await Promise.all([
    loadProfileInput(userId, { client, now }),
    askedFacts(userId, client),
  ]);
  // Asked once: answered, skipped, or already put to them (whatever became of the message).
  const asked = new Set([
    ...answered,
    ...posted.map((m) => m.dedupeKey.slice("questions:".length)),
  ]);
  const best = bestQuestion(buildProfile(data), data, asked);
  return best
    ? {
        fact: best.spec.fact,
        text: best.spec.text,
        choices: best.spec.choices,
        unlockCents: best.unlockCents,
      }
    : null;
}

export class QuestionError extends Error {}

async function markAsked(userId: string, fact: string, client: PrismaClient, now: Date) {
  await client.janePreference.upsert({
    where: { userId_kind_key: { userId, kind: "system", key: `${ASKED}${fact}` } },
    create: {
      userId,
      kind: "system",
      key: `${ASKED}${fact}`,
      value: { on: now.toISOString().slice(0, 10) },
      label: "Asked",
    },
    update: {},
  });
}

// The person taps an answer (position 1–4), or skips (position 5, or past the choices).
export async function answerQuestion(
  userId: string,
  fact: string,
  position: number,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ answered: boolean; label: string | null }> {
  const spec = QUESTIONS.find((q) => q.fact === fact);
  if (!spec) throw new QuestionError("That question isn't there any more.");
  const choice = spec.choices[position - 1];
  if (choice) await correctFact(userId, fact, choice.value, { client, now });
  await markAsked(userId, fact, client, now);
  return { answered: Boolean(choice), label: choice?.label ?? null };
}
