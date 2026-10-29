import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { scrub } from "@/lib/scrub";
import type { Profile, ProfileInput } from "@/profile/build";
import { recordFacts, type RecordOutcome } from "./facts";
import { factsFromChat } from "./from-chat";
import { factsFromData } from "./from-data";

// Where Jane learns: each interaction hands its evidence to the profile memory (./facts.ts).
// Learning never gets in the way of what the person was doing: a failure is logged (never
// the words) and the interaction carries on.

type Options = { client?: PrismaClient; now?: Date };

async function safely(
  what: string,
  userId: string,
  work: () => Promise<RecordOutcome[]>,
): Promise<RecordOutcome[]> {
  try {
    return await work();
  } catch (error) {
    console.error("Couldn't update what Jane knows", {
      what,
      userId,
      error: scrub(String(error)).slice(0, 300),
    });
    return [];
  }
}

// A message the person typed: what it says about them, linked to the message.
export async function learnFromChat(
  userId: string,
  text: string,
  messageRef: string,
  options: Options = {},
): Promise<RecordOutcome[]> {
  const drafts = factsFromChat(text).map((d) => ({
    ...d,
    source: "chat" as const,
    sourceRef: messageRef,
  }));
  if (drafts.length === 0) return [];
  return safely("chat", userId, () => recordFacts(userId, drafts, options));
}

// The bank the person's most-used linked accounts are at.
async function mainBankOf(userId: string, client: PrismaClient): Promise<string | null> {
  const accounts = await scopedFor(userId, client).accounts.findMany({
    where: { source: "plaid", type: "depository" },
    select: {
      item: { select: { institutionName: true } },
      _count: { select: { transactions: true } },
    },
  });
  const byBank = new Map<string, number>();
  for (const a of accounts) {
    const name = a.item?.institutionName?.trim();
    if (name) byBank.set(name, (byBank.get(name) ?? 0) + a._count.transactions);
  }
  return [...byBank.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// An upload or the nightly scan: what the profile it just built shows. "upload" when every
// account came from statements, "detector" when a bank is linked.
export async function learnFromData(
  userId: string,
  profile: Profile,
  input: ProfileInput,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<RecordOutcome[]> {
  return safely("data", userId, async () => {
    const linked = await scopedFor(userId, client).accounts.count({ where: { source: "plaid" } });
    const drafts = factsFromData(profile, input, {
      source: linked > 0 ? "detector" : "upload",
      mainBank: linked > 0 ? await mainBankOf(userId, client) : null,
    });
    return recordFacts(userId, drafts, { client, now });
  });
}

const topicWords = (topic: string) =>
  topic
    .replace(/[_:-]+/g, " ")
    .trim()
    .slice(0, 40);

// What the person did with a suggestion or a card: over time, which kinds they act on and which
// they pass on. Each answer is one piece of evidence; a habit flips only when the answers do.
export async function learnFromAnswer(
  userId: string,
  { topic, acted, ref }: { topic: string; acted: boolean; ref: string },
  options: Options = {},
): Promise<RecordOutcome[]> {
  const words = topicWords(topic);
  if (!words) return [];
  return safely("action", userId, () =>
    recordFacts(
      userId,
      [
        {
          key: `habit:${topic.slice(0, 60)}`,
          value: acted ? "acts" : "passes",
          label: acted
            ? `You tend to act on ${words} suggestions`
            : `You tend to pass on ${words} suggestions`,
          source: "action",
          sourceRef: ref,
        },
      ],
      options,
    ),
  );
}
