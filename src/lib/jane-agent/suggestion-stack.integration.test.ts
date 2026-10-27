import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { SUGGESTIONS_PER_DAY } from "@/config/suggestions";
import { BUNDLED_UNTIL, stackedSuggestions } from "./messages";

// The cards in the stack over the chat are the day's suggestions still waiting, the agenda's
// hidden ones too, and not the answered, the old, or other messages.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T16:00:00Z");

describe.runIf(url)("the suggestions in the card stack", () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `stack-${crypto.randomUUID()}@example.com` } })
    ).id;
    const make = (key: string, minutesAgo: number, over: Record<string, unknown> = {}) =>
      client.janeMessage.create({
        data: {
          userId,
          kind: "decision",
          body: `${key} headline\nWhy you: x 1.\n80% sure: y.`,
          dedupeKey: `${key}:${minutesAgo}`,
          refs: { suggestion: key },
          actions: [{ id: "suggestion.yes", label: "Do it", kind: "primary" }],
          createdAt: new Date(NOW.getTime() - minutesAgo * 60_000),
          ...over,
        },
      });
    // The suggestions behind the messages: live ones, and one the scan has dropped.
    const suggestion = (key: string, status: string) =>
      client.suggestion.create({
        data: {
          userId,
          key,
          capability: key.split(":")[0],
          topic: key.split(":")[1],
          title: key,
          worthCents: 1_000,
          worthKind: "saves",
          confidencePercent: 80,
          confidenceReason: "y",
          urgency: "soon",
          why: "x",
          actionLabel: "Do it",
          actionHref: "/home",
          status,
        },
      });
    for (const key of ["a:one", "b:two", "c:answered", "d:old", "e:three"])
      await suggestion(key, "selected");
    await suggestion("f:gone", "gone");
    await make("f:gone", 15);
    await make("a:one", 50);
    // Hidden behind the day's agenda: still a card.
    await make("b:two", 40, { snoozedUntil: BUNDLED_UNTIL });
    await make("c:answered", 30, { status: "answered" });
    await make("d:old", 60 * 48);
    await make("e:three", 20);
    // A practice idea's alert (a news theme) has no suggestion row until it's answered: a card.
    await make("practice:theme_idea:x", 45);
    await client.janeMessage.create({
      data: {
        userId,
        kind: "decision",
        body: "Not a suggestion",
        dedupeKey: "other",
        refs: {},
        actions: [],
        createdAt: new Date(NOW.getTime() - 10 * 60_000),
      },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("lists the waiting ones, best first, without answered, old, gone or other messages", async () => {
    const stacked = await stackedSuggestions(userId, { client, now: NOW });
    // The day's three newest still waiting, oldest first (a:one, older, is past the three).
    expect(stacked.map((m) => m.refs.suggestion)).toEqual([
      "practice:theme_idea:x",
      "b:two",
      "e:three",
    ]);
    expect(stacked.length).toBeLessThanOrEqual(SUGGESTIONS_PER_DAY);
  });
});
