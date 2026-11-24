import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { CHAT_PAGE_SIZE } from "@/config/agent-chat";
import { chatFeed, pinnedMessages, visibleCount } from "./messages";
import { CHAT_KINDS } from "./popups";

// The chat holds only what was typed and Jane's answers (CHAT_KINDS, founder 11-24). Applied after
// the page's limit, a page of the cards Jane brought up on its own would come back short or empty
// with the conversation hidden behind "Show earlier" (CodeRabbit on #2243); applied before it, the
// limit counts only the chat's own messages.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("the chat's page of messages", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({
        data: { email: `chat-feed-kinds-${crypto.randomUUID()}@example.com` },
      })
    ).id;
    const at = (minutes: number) => new Date(Date.UTC(2026, 10, 24, 12, minutes));
    const row = (kind: string, body: string, minutes: number, key: string) => ({
      userId,
      kind,
      body,
      dedupeKey: key,
      createdAt: at(minutes),
    });
    // What was said first, then more cards than a page holds.
    await client.janeMessage.createMany({
      data: [
        row("user", "how much is netflix?", 0, "typed:1"),
        row("reply", "Netflix is $15.49 a month.", 1, "reply:1"),
        ...Array.from({ length: CHAT_PAGE_SIZE + 10 }, (_, i) =>
          row(i % 2 ? "decision" : "heads_up", `Card ${i}`, 10 + i, `card:${i}`),
        ),
      ],
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("is the whole conversation when only the chat's kinds are asked for", async () => {
    const feed = await chatFeed(userId, { client, kinds: CHAT_KINDS });
    expect(feed.messages.map((m) => m.body)).toEqual([
      "how much is netflix?",
      "Netflix is $15.49 a month.",
    ]);
    expect(feed.hasEarlier).toBe(false);
  });

  it("would be only cards, with the conversation behind Show earlier, without that", async () => {
    const feed = await chatFeed(userId, { client });
    expect(feed.messages).toHaveLength(CHAT_PAGE_SIZE);
    expect(feed.messages.some((m) => m.kind === "user" || m.kind === "reply")).toBe(false);
    expect(feed.hasEarlier).toBe(true);
  });

  // The pinned list links each pin to its message in the chat: a card pinned back when cards were in
  // the chat has no message there now (CodeRabbit's command-line review of #2243).
  it("lists a pinned answer, and not a pinned card the chat no longer holds", async () => {
    await client.janeMessage.updateMany({
      where: { userId, body: { in: ["Netflix is $15.49 a month.", "Card 3"] } },
      data: { refs: { pinned: true } },
    });
    const pinned = await pinnedMessages(userId, { client });
    expect(pinned.map((m) => m.body)).toEqual(["Netflix is $15.49 a month."]);
  });

  it("is counted by the pulse with every kind, cards included", async () => {
    expect(await visibleCount(userId, { client })).toBe(CHAT_PAGE_SIZE + 12);
  });
});
