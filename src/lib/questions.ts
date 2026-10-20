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

const NEXT = "question:next";

// Works out, from the whole profile, the question to ask next and keeps it (the nightly scan
// runs this, step 257): the chat then reads one row instead of rebuilding the profile for
// every message. Returns the fact, or null when nothing is worth asking.
export async function planQuestion(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<string | null> {
  const db = scopedFor(userId, client);
  const posted = await db.janeMessages.findMany({
    where: { dedupeKey: { startsWith: "questions:" } },
    select: { dedupeKey: true },
  });
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
  const value = best ? { fact: best.spec.fact, unlockCents: best.unlockCents } : {};
  await client.janePreference.upsert({
    where: { userId_kind_key: { userId, kind: "system", key: NEXT } },
    create: { userId, kind: "system", key: NEXT, value, label: "Next question" },
    update: { value },
  });
  return best?.spec.fact ?? null;
}

// The question to ask now, or null: none worth asking, or one is already waiting for an
// answer (one at a time). Cheap: it reads what planQuestion kept.
export async function nextQuestion(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<OpenQuestion | null> {
  const db = scopedFor(userId, client);
  const [kept, posted, answered] = await Promise.all([
    db.janePreferences.findFirst({ where: { kind: "system", key: NEXT }, select: { value: true } }),
    db.janeMessages.findMany({
      where: { dedupeKey: { startsWith: "questions:" } },
      select: { dedupeKey: true, status: true },
    }),
    askedFacts(userId, client),
  ]);
  const value = kept?.value as { fact?: string; unlockCents?: number } | null;
  if (!value?.fact || posted.some((m) => m.status === "open")) return null;
  const fact = value.fact;
  if (answered.has(fact) || posted.some((m) => m.dedupeKey === `questions:${fact}`)) return null;
  const spec = QUESTIONS.find((q) => q.fact === fact);
  return spec
    ? { fact, text: spec.text, choices: spec.choices, unlockCents: value.unlockCents ?? 0 }
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
