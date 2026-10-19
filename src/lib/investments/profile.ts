import type { ProfileQuestionKey } from "@/config/investing";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import {
  EMPTY_ANSWERS,
  isComplete,
  parseAnswer,
  parseProfileForm,
  type ProfileAnswers,
} from "@/planning/investor-profile";

// The person's investor profile (spec step 129): read, answered one question at a time from
// the chat, or saved whole from /investments/profile. Scoped to the person. answeredAt is
// set when the last of the four goes in, and kept through later changes.

type Options = { client?: PrismaClient; now?: Date };

const SELECT = {
  age: true,
  ageOn: true,
  horizon: true,
  dropReaction: true,
  goals: true,
  answeredAt: true,
  updatedAt: true,
} as const;

const toAnswers = (row: {
  age: number | null;
  ageOn: Date | null;
  horizon: string | null;
  dropReaction: string | null;
  goals: string[];
  answeredAt: Date | null;
  updatedAt: Date | null;
}): ProfileAnswers => ({ ...row, ageOn: row.ageOn ? row.ageOn.toISOString().slice(0, 10) : null });

export async function profileOf(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<ProfileAnswers> {
  const row = await scopedFor(userId, client).investorProfiles.findFirst({ select: SELECT });
  return row ? toAnswers(row) : EMPTY_ANSWERS;
}

async function save(
  userId: string,
  next: Omit<ProfileAnswers, "answeredAt" | "updatedAt">,
  changed: string,
  { client, now }: Required<Options>,
): Promise<ProfileAnswers> {
  const db = scopedFor(userId, client);
  const before = await profileOf(userId, { client });
  const complete = isComplete(next);
  const data = {
    age: next.age,
    ageOn: next.ageOn ? new Date(`${next.ageOn}T00:00:00Z`) : null,
    horizon: next.horizon,
    dropReaction: next.dropReaction,
    goals: next.goals,
    answeredAt: complete ? (before.answeredAt ?? now) : null,
  };
  const row = await db.investorProfiles.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
    select: SELECT,
  });
  await logAudit(
    { type: "user", id: userId },
    "investor_profile_saved",
    { type: "user", id: userId },
    { changed, complete },
  );
  await track(userId, "investor_profile_saved", { changed, complete });
  return toAnswers(row);
}

// One answer from the chat's buttons.
export async function answerProfileQuestion(
  userId: string,
  key: ProfileQuestionKey,
  value: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ProfileAnswers> {
  const before = await profileOf(userId, { client });
  const answer = parseAnswer(key, value, now.toISOString().slice(0, 10));
  const { answeredAt: _, updatedAt: __, ...rest } = before;
  return save(userId, { ...rest, ...answer }, key, { client, now });
}

// Every answer at once, from the profile page.
export async function saveProfileForm(
  userId: string,
  input: { age: string; horizon: string; dropReaction: string; goals: string[] },
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ProfileAnswers> {
  const next = parseProfileForm(input, now.toISOString().slice(0, 10));
  return save(userId, next, "all", { client, now });
}
