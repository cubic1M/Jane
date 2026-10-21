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
    await make("a:one", 50);
    // Hidden behind the day's agenda: still a card.
    await make("b:two", 40, { snoozedUntil: BUNDLED_UNTIL });
    await make("c:answered", 30, { status: "answered" });
    await make("d:old", 60 * 48);
    await make("e:three", 20);
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

  it("lists the waiting ones, best first, without answered, old or other messages", async () => {
    const stacked = await stackedSuggestions(userId, { client, now: NOW });
    expect(stacked.map((m) => m.refs.suggestion)).toEqual(["a:one", "b:two", "e:three"]);
    expect(stacked.length).toBeLessThanOrEqual(SUGGESTIONS_PER_DAY);
  });
});
