import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { MORNING_BRIEF } from "@/config/agent-chat";
import { BUNDLED_UNTIL, openPopupMessages } from "./messages";

// The pop-ups are Jane's open messages that wait on the person, and not what is put off until
// later. While the morning brief is off (MORNING_BRIEF), what it bundled behind itself comes up
// on its own.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-24T16:00:00Z");

describe.runIf(url)("the messages that pop up", () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `popups-${crypto.randomUUID()}@example.com` } })
    ).id;
    const make = (key: string, minutesAgo: number, over: Record<string, unknown> = {}) =>
      client.janeMessage.create({
        data: {
          userId,
          kind: "decision",
          body: `${key}\nMore about it.`,
          dedupeKey: key,
          refs: {},
          actions: [{ id: "do", label: "Do it", kind: "primary" }],
          createdAt: new Date(NOW.getTime() - minutesAgo * 60_000),
          ...over,
        },
      });
    await make("open", 10);
    await make("bundled", 20, { snoozedUntil: BUNDLED_UNTIL });
    await make("put off", 30, { snoozedUntil: new Date(NOW.getTime() + 60 * 60_000) });
    await make("back again", 40, { snoozedUntil: new Date(NOW.getTime() - 60_000) });
    await make("answered", 50, { status: "answered" });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("leaves out what's put off, as the chat does, newest first", async () => {
    const rows = await openPopupMessages(userId, { client, now: NOW });
    const shown = rows.map((m) => m.body.split("\n")[0]);
    expect(shown).not.toContain("put off");
    expect(shown).not.toContain("answered");
    expect(shown).toEqual(
      MORNING_BRIEF ? ["open", "back again"] : ["open", "bundled", "back again"],
    );
  });

  // CodeRabbit part 2: a heads-up a scan posts between a question and Jane's answer is not the answer.
  it("keeps a heads-up posted before the answer in the pop-ups, and leaves the answer out", async () => {
    const other = (
      await client.user.create({ data: { email: `popups2-${crypto.randomUUID()}@example.com` } })
    ).id;
    try {
      const at = (min: number) => new Date(NOW.getTime() - min * 60_000);
      const post = (kind: string, key: string, min: number) =>
        client.janeMessage.create({
          data: { userId: other, kind, body: key, dedupeKey: key, createdAt: at(min) },
        });
      await post("user", "typed", 4);
      await post("heads_up", "scan-heads-up", 3);
      await post("decision", "the-answer", 2);
      const shown = (await openPopupMessages(other, { client, now: NOW })).map((m) => m.body);
      expect(shown).toContain("scan-heads-up");
      expect(shown).not.toContain("the-answer");
    } finally {
      await client.user.deleteMany({ where: { id: other } });
    }
  });
});
