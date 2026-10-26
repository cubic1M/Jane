import { ATTENTION_DAYS } from "@/config/attention";
import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { alwaysSaid, labelOf, learnAttention, type Attention } from "./attention";
import { BUNDLED_UNTIL } from "./messages";

// Asking less (spec step 147): what Jane learned, from its own messages of the last couple
// of months, and bringing a stopped kind back (from Settings or the chat), kept in
// jane_preferences as kind "attention", key "resume:<source>".

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 24 * 60 * 60 * 1000;
const RESUME = "resume:";

export async function loadAttention(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    timezone,
  }: Options & { timezone?: string | null } = {},
): Promise<Attention> {
  const db = scopedFor(userId, client);
  const [messages, resumes, user] = await Promise.all([
    db.janeMessages.findMany({
      where: {
        createdAt: { gt: new Date(now.getTime() - ATTENTION_DAYS * DAY_MS), lte: now },
        // Findings behind a bundle are answered through the bundle.
        OR: [{ snoozedUntil: null }, { snoozedUntil: { not: BUNDLED_UNTIL } }],
      },
      select: {
        dedupeKey: true,
        kind: true,
        actions: true,
        status: true,
        answeredWith: true,
        answeredAt: true,
        createdAt: true,
        notifiedVia: true,
      },
    }),
    db.janePreferences.findMany({
      where: { kind: "attention", key: { startsWith: RESUME } },
      select: { key: true, createdAt: true },
    }),
    timezone === undefined
      ? client.user.findUnique({ where: { id: userId }, select: { timezone: true } })
      : null,
  ]);
  const resumed = Object.fromEntries(resumes.map((r) => [r.key.slice(RESUME.length), r.createdAt]));
  return learnAttention(messages, {
    timezone: timezone === undefined ? (user?.timezone ?? null) : timezone,
    now,
    resumed,
  });
}

export class AttentionError extends Error {}

// "Bring them back": that kind counts afresh from now.
export async function resumeKind(
  userId: string,
  source: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<string> {
  if (!/^[a-z_]+$/.test(source) || alwaysSaid(source)) {
    throw new AttentionError("That kind of message was never stopped.");
  }
  const label = labelOf(source);
  const key = `${RESUME}${source}`;
  const data = { value: {}, label: `Bring back ${label}`, createdAt: now };
  await client.janePreference.upsert({
    where: { userId_kind_key: { userId, kind: "attention", key } },
    create: { userId, kind: "attention", key, ...data },
    update: data,
  });
  await logAudit(
    { type: "user", id: userId },
    "preference_saved",
    { type: "user", id: userId },
    { kind: "attention" },
  );
  return label;
}
