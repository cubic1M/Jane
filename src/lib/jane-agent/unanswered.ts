import { CHAT_UNANSWERED_DAYS } from "@/config/agent-chat";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";

// Spec step 93: what Jane couldn't answer, by kind, for the team (/admin/chat). From the
// chat_message_sent events (src/lib/jane-agent/typing.ts), which hold the kind of question
// and how it was answered, never its words: so this is team data about the chat, not about
// anyone.

export const NOT_ANSWERED_SOURCES = ["fallback", "claude_unavailable", "claude_blocked"] as const;

export type Unanswered = {
  asked: number;
  notAnswered: number;
  // By the rules' reading of the question and how it ended, the most first.
  byKind: { intent: string; how: string; count: number }[];
  // Blocked answers by guardrail rule, the most first.
  blockedBy: { issue: string; count: number }[];
};

const text = (v: unknown) => (typeof v === "string" ? v : "");

export function unansweredByKind(events: readonly { properties: unknown }[]): Unanswered {
  const kinds = new Map<string, { intent: string; how: string; count: number }>();
  const blocked = new Map<string, number>();
  let notAnswered = 0;
  for (const event of events) {
    const props = (event.properties ?? {}) as Record<string, unknown>;
    const how = text(props.source);
    if (!(NOT_ANSWERED_SOURCES as readonly string[]).includes(how)) continue;
    notAnswered += 1;
    const intent = text(props.intent) || "unknown";
    const key = `${intent}|${how}`;
    kinds.set(key, { intent, how, count: (kinds.get(key)?.count ?? 0) + 1 });
    for (const issue of text(props.issues).split(",").filter(Boolean)) {
      blocked.set(issue, (blocked.get(issue) ?? 0) + 1);
    }
  }
  return {
    asked: events.length,
    notAnswered,
    byKind: [...kinds.values()].sort(
      (a, b) => b.count - a.count || a.intent.localeCompare(b.intent) || a.how.localeCompare(b.how),
    ),
    blockedBy: [...blocked.entries()]
      .map(([issue, count]) => ({ issue, count }))
      .sort((a, b) => b.count - a.count),
  };
}

// The last CHAT_UNANSWERED_DAYS of typed questions, across everyone (a team view).
export async function loadUnanswered({
  client = defaultClient,
  now = new Date(),
}: { client?: PrismaClient; now?: Date } = {}): Promise<Unanswered> {
  const events = await client.analyticsEvent.findMany({
    where: {
      name: "chat_message_sent",
      createdAt: { gte: new Date(now.getTime() - CHAT_UNANSWERED_DAYS * 24 * 60 * 60 * 1000) },
    },
    select: { properties: true },
  });
  return unansweredByKind(events);
}
