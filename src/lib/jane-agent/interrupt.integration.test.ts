import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { CHAT_TYPING_PAUSE_MINUTES } from "@/config/agent-chat";
import { ChatActionError, takeChatAction } from "./actions";
import { createCheckPerson, deleteCheckPerson } from "./checks/person";
import { chatFeed } from "./messages";
import { openChat } from "./open";
import { AS_THEY_COME } from "./preferences";
import { runJaneAgent } from "./run";
import { sendToJane } from "./typing";

// Spec step 92 against a real, migrated Postgres and the demo bank: while the person is
// chatting, Jane's own messages wait and come after, never between a question and its
// answer; findings of one kind come as one message, and each Yes on it is that finding's
// own Yes.

const url = process.env.TEST_DATABASE_URL;
// 8am in Los Angeles.
const LINKED = new Date("2026-10-18T15:00:00Z");
const at = (minutes: number) => new Date(LINKED.getTime() + minutes * 60_000);
const ownKinds = ["brief", "decision", "done", "heads_up"];

describe.runIf(url)("never interrupt, against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    // Linked, but Jane hasn't said anything yet.
    userId = await createCheckPerson({ client, now: LINKED });
    otherId = await createCheckPerson({ client, now: LINKED });
    await client.janeMessage.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  }, 120_000);
  afterAll(async () => {
    await deleteCheckPerson(userId, { client });
    await deleteCheckPerson(otherId, { client });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("holds Jane's own messages while the person chats, and posts them after", async () => {
    await sendToJane(userId, "safe to spend", { client, now: at(0) });
    // A sync and a visit while they're chatting: nothing of Jane's own.
    expect(await runJaneAgent(userId, { client, now: at(1), trigger: "sync" })).toEqual({
      posted: 0,
    });
    await openChat(userId, { client, now: at(2) });
    expect(await client.janeMessage.count({ where: { userId, kind: { in: ownKinds } } })).toBe(0);

    // Once they've stopped, the next visit brings it all, after the conversation.
    const after = at(CHAT_TYPING_PAUSE_MINUTES + 1);
    await openChat(userId, { client, now: after });
    const { messages } = await chatFeed(userId, { client, now: after });
    const kinds = messages.map((m) => m.kind);
    expect(kinds.slice(0, 2)).toEqual(["user", "reply"]);
    expect(kinds.slice(2).every((k) => ownKinds.includes(k))).toBe(true);
    expect(kinds.length).toBeGreaterThan(2);
  });

  it("shows findings of one kind as one message, and each Yes is that finding's own", async () => {
    // Bundles are for things as they come (spec step 184's agenda lists them itself).
    await client.janePreference.create({
      data: { userId, ...AS_THEY_COME, value: AS_THEY_COME.value },
    });
    // On the demo bank, more urgent things take the first days' slots: the daily job runs
    // each morning until the subscriptions to review come up, together.
    let tomorrow = at(0);
    let messages: Awaited<ReturnType<typeof chatFeed>>["messages"] = [];
    for (let day = 1; day <= 7 && !messages.some((m) => m.refs.items); day += 1) {
      tomorrow = at(day * 24 * 60 + 60);
      await runJaneAgent(userId, { client, now: tomorrow, trigger: "cron" });
      ({ messages } = await chatFeed(userId, { client, now: tomorrow }));
    }
    const bundle = messages.find((m) => m.actions.some((a) => a.id === "bundle.1"))!;
    expect(bundle.body).toMatch(/^I found \d+ /);
    const items = bundle.refs.items!;
    // The findings behind it aren't shown on their own.
    const hidden = await client.janeMessage.findMany({
      where: { userId, dedupeKey: { in: items.map((i) => i.dedupeKey) } },
    });
    expect(hidden).toHaveLength(items.length);
    expect(messages.map((m) => m.id)).not.toEqual(expect.arrayContaining([hidden[0].id]));

    await expect(
      takeChatAction(otherId, bundle.id, "bundle.1", { client, now: tomorrow }),
    ).rejects.toBeInstanceOf(ChatActionError);

    const { message } = await takeChatAction(userId, bundle.id, "bundle.1", {
      client,
      now: tomorrow,
    });
    expect(message.status).toBe("open");
    expect(message.actions.map((a) => a.id)).not.toContain("bundle.1");
    expect(message.refs.note).toMatch(/^.+: Got it\./);
    const first = hidden.find((h) => h.dedupeKey === items[0].dedupeKey)!;
    const findingId = (first.refs as { findingId: string }).findingId;
    expect(await client.decision.findFirstOrThrow({ where: { userId, findingId } })).toMatchObject({
      choice: "yes",
      source: "chat",
    });
    // The same Yes can't be tapped twice.
    await expect(
      takeChatAction(userId, bundle.id, "bundle.1", { client, now: tomorrow }),
    ).rejects.toMatchObject({ code: "not_offered" });
  });
});
