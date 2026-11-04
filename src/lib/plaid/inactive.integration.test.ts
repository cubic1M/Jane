import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { runInactiveCleanup } from "./inactive";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;

describe.runIf(url)("inactive cleanup against a real database", () => {
  let client: PrismaClient;
  const ids: string[] = [];
  const NOW = new Date();

  async function person(name: string, lastActiveDaysAgo: number) {
    const user = await client.user.create({
      data: {
        email: `${name}-${crypto.randomUUID()}@example.com`,
        createdAt: new Date(NOW.getTime() - 200 * DAY),
      },
    });
    ids.push(user.id);
    await client.plaidItem.create({
      data: { userId: user.id, plaidItemId: `i-${user.id}`, accessTokenEncrypted: "x" },
    });
    // A sync event doesn't count; a report view does.
    await client.analyticsEvent.create({
      data: { userId: user.id, name: "detection_completed", createdAt: NOW },
    });
    await client.analyticsEvent.create({
      data: {
        userId: user.id,
        name: "report_viewed",
        createdAt: new Date(NOW.getTime() - lastActiveDaysAgo * DAY),
      },
    });
    return user.id;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: ids } } });
    await client.$disconnect();
  });

  it("leaves alone someone who only chats, or only opens pages", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const chats = await person("chats", 55);
    await client.analyticsEvent.create({
      data: { userId: chats, name: "chat_message_sent", createdAt: new Date(NOW.getTime() - DAY) },
    });
    const reads = await person("reads", 55);
    await client.session.create({
      data: {
        sessionToken: `inactive-${crypto.randomUUID()}`,
        userId: reads,
        expires: new Date(NOW.getTime() + DAY),
        lastSeenAt: new Date(NOW.getTime() - DAY),
      },
    });
    const send = vi.fn();
    const remove = vi.fn();
    const run = await runInactiveCleanup({
      client,
      now: NOW,
      send,
      remove,
      userIds: [chats, reads],
    });
    expect(run).toMatchObject({ warned: 0, removed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("warns, then removes a week later, leaving active people alone", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const active = await person("active", 3);
    const quiet = await person("quiet", 55);
    // Just as quiet, but left out of the run (as another test file's person would be).
    const outsider = await person("outsider", 55);
    const userIds = [active, quiet];
    const send = vi.fn();
    const remove = vi.fn();

    await runInactiveCleanup({ client, now: NOW, send, remove, userIds });
    expect(
      (await client.user.findUniqueOrThrow({ where: { id: quiet } })).plaidRemovalWarnedAt,
    ).toEqual(NOW);
    expect(
      (await client.user.findUniqueOrThrow({ where: { id: active } })).plaidRemovalWarnedAt,
    ).toBeNull();
    expect(remove).not.toHaveBeenCalled();

    const weekLater = new Date(NOW.getTime() + 7 * DAY);
    await runInactiveCleanup({ client, now: weekLater, send, remove, userIds });
    expect(remove.mock.calls.filter((c) => c[0] === quiet)).toHaveLength(1);
    expect(remove.mock.calls.some((c) => c[0] === active)).toBe(false);
    expect(remove.mock.calls[0][2]).toBe("inactive");
    expect(
      (await client.user.findUniqueOrThrow({ where: { id: outsider } })).plaidRemovalWarnedAt,
    ).toBeNull();
    expect(remove.mock.calls.some((c) => c[0] === outsider)).toBe(false);
  });
});
