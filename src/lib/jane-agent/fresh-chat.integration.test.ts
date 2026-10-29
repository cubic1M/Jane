import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { chatSince, sessionStartedAt } from "@/lib/chat-start";
import { chatFeed, pinnedMessages } from "./messages";
import { lastTopic, recentTurns } from "./typing";

// Each sign-in starts the chat fresh, against a real, migrated Postgres: what was said before this
// session began stays stored but isn't shown, isn't Claude's history and isn't what "it" means;
// what comes after is all there.

const url = process.env.TEST_DATABASE_URL;
const BEFORE = new Date("2026-10-28T15:00:00Z");
const SIGNED_IN = new Date("2026-10-29T15:00:00Z");
const after = (minutes: number) => new Date(SIGNED_IN.getTime() + minutes * 60_000);

describe.runIf(url)("a fresh chat at each sign-in, against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let since: Date;

  const post = (kind: string, body: string, createdAt: Date, refs: object = {}) =>
    client.janeMessage.create({
      data: {
        userId,
        kind,
        body,
        refs,
        dedupeKey: `${kind}:${crypto.randomUUID()}`,
        createdAt,
      },
    });

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `fresh-chat-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const token = `fresh-${crypto.randomUUID()}`;
    await client.session.create({
      data: { sessionToken: token, userId, expires: after(60 * 24), createdAt: SIGNED_IN },
    });
    since = chatSince((await sessionStartedAt(token, { client }))!);

    await post("user", "I rent, and is Hulu worth it?", BEFORE);
    await post("reply", "Hulu costs you $18 a month.", new Date(BEFORE.getTime() + 1), {
      topic: { kind: "subscription", target: "hulu" },
      pinned: true,
    });
    await post("user", "what about netflix?", after(1));
    await post("reply", "Netflix costs you $15 a month.", after(1.001), {
      topic: { kind: "subscription", target: "netflix" },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("shows only this sign-in's messages, and keeps the older ones stored", async () => {
    const fresh = await chatFeed(userId, { client, now: after(2), since });
    expect(fresh.messages.map((m) => m.body)).toEqual([
      "what about netflix?",
      "Netflix costs you $15 a month.",
    ]);
    expect(fresh.hasEarlier).toBe(false);
    expect(await pinnedMessages(userId, { client, since })).toEqual([]);
    // Nothing was deleted: without a sign-in (a test, the data export) everything is there.
    expect((await chatFeed(userId, { client, now: after(2) })).messages).toHaveLength(4);
    expect(await pinnedMessages(userId, { client })).toHaveLength(1);
  });

  it("gives Claude only this sign-in's conversation, and 'it' only this sign-in's topic", async () => {
    expect((await recentTurns(userId, { client, since })).map((t) => t.content)).toEqual([
      "what about netflix?",
      "Netflix costs you $15 a month.",
    ]);
    expect(await recentTurns(userId, { client })).toHaveLength(4);
    expect(await lastTopic(userId, { client, now: after(2), since })).toEqual({
      kind: "subscription",
      target: "netflix",
    });
    // Signed in again: the last answer was before this session, so "it" means nothing yet.
    expect(await lastTopic(userId, { client, now: after(2), since: after(1.5) })).toBeNull();
  });
});
