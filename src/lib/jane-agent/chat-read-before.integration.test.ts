import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { markChatRead } from "./messages";

// CodeRabbit part 2: opening the chat marks read what was on the page, not a message that came in
// while it loaded (that one keeps its unread dot and its notification).

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("marking the chat read", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({ data: { email: `read-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("leaves a message that arrived after the page was read unread", async () => {
    const loaded = new Date("2026-10-18T15:00:00Z");
    const make = (dedupeKey: string, createdAt: Date) =>
      client.janeMessage.create({
        data: { userId, kind: "heads_up", body: "x", dedupeKey, createdAt },
      });
    const seen = await make("seen", new Date(loaded.getTime() - 1_000));
    const late = await make("late", new Date(loaded.getTime() + 1_000));
    await markChatRead(userId, { client, now: loaded, before: loaded });
    expect(
      (await client.janeMessage.findUniqueOrThrow({ where: { id: seen.id } })).readAt,
    ).not.toBeNull();
    expect(
      (await client.janeMessage.findUniqueOrThrow({ where: { id: late.id } })).readAt,
    ).toBeNull();
  });
});
