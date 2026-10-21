import type { PrismaClient } from "@/generated/prisma/client";
import { loadSnapshotFast } from "./snapshot-store";
import { db as defaultClient } from "@/lib/db";
import { capabilityFor } from "./capabilities";
import { topicOf, withTopic, type Topic } from "./context";
import type { Intent } from "./intents";
import { clarifyReply, type Reply } from "./replies";
import { loadSnapshot } from "./snapshot";

// Answers a typed message by rules (spec step 84): loads only what the intent needs, with
// the same loaders as the pages, all scoped to the person, and words it with ./replies.
// Null when the rules can't answer ("unknown"): that's for Claude, when there's a key.
// Spec step 88: a follow-up is read against what the conversation was about (topic), and
// each answer says what it was about, for the next one.

type Options = { client?: PrismaClient; now?: Date; topic?: Topic | null };

export async function answerByRules(
  userId: string,
  typed: Intent,
  { client = defaultClient, now = new Date(), topic = null }: Options = {},
): Promise<Reply | null> {
  const asOf = now.toISOString().slice(0, 10);
  const resolved = withTopic(typed, topic, asOf);
  if (resolved.kind === "which") return whichReply(userId, { client, now });
  const reply = await byIntent(userId, resolved, { client, now });
  if (reply) {
    const about = topicOf(resolved);
    if (about || reply.refs.topic) {
      reply.refs = { ...reply.refs, topic: { ...about, ...reply.refs.topic } as Topic };
    }
  }
  return reply;
}

// "Cancel it" with nothing to point back to: which of the biggest savings?
async function whichReply(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  const snapshot = await loadSnapshotFast(userId, { client, now });
  const top = [...(snapshot?.findings ?? [])]
    .sort((a, b) => (b.annualSavingsCents ?? -1) - (a.annualSavingsCents ?? -1))
    .map((f) => ({
      label: f.title,
      intent: { kind: "about" as const, target: f.title, findingId: f.findingId },
    }));
  return top.length > 0
    ? clarifyReply("Which one do you mean?", top)
    : { body: 'Which one do you mean? Try its name, like "Netflix".', actions: [], refs: {} };
}
async function byIntent(
  userId: string,
  intent: Intent,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply | null> {
  // Spec step 190: each kind of question is answered by its registered capability
  // (./capabilities/index.ts).
  const capability = capabilityFor(intent);
  if (!capability) return null;
  return capability.answer({
    userId,
    intent,
    client,
    now,
    asOf: now.toISOString().slice(0, 10),
    ask: (part) => byIntent(userId, part, { client, now }),
  });
}
