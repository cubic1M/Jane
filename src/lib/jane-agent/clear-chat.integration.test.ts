import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { clearChat } from "./clear-chat";
import { sendToJane, recentTurns } from "./typing";

// "Clear chat": the person's typed messages, Jane's answers, Ask Jane's conversations and the pins
// go for good; memory, suggestions and money data stay; another person's chat is untouched.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-28T18:00:00Z");
const SECRET = "my landlord Zorblax charges 1850 and I hate it";

describe.runIf(url)("Clear chat", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let me = "";
  let other = "";

  const seed = async (who: string) => {
    const user = await client.user.create({
      data: { email: `clear-${who}-${crypto.randomUUID()}@example.com`, timezone: "UTC" },
    });
    const at = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
    const message = (key: string, kind: string, body: string, minutes: number, refs = {}) => ({
      userId: user.id,
      kind,
      body,
      refs,
      dedupeKey: key,
      createdAt: at(minutes),
    });
    await client.janeMessage.createMany({
      data: [
        message("typed:1", "user", SECRET, 30),
        message("reply:1", "reply", `About ${SECRET}: that is your rent.`, 29, { pinned: true }),
        message("typed:2", "user", "what is my balance", 20),
        message("reply:2", "reply", "Your balance is on the Home page.", 19),
        message("finding:1", "decision", "Cancel an unused gym?", 90, { pinned: true }),
        message("brief:1", "brief", "Your morning brief", 100),
      ],
    });
    const conversation = await client.askConversation.create({
      data: { userId: user.id, title: "Rent" },
    });
    await client.askMessage.create({
      data: { conversationId: conversation.id, userId: user.id, role: "user", content: SECRET },
    });
    await client.userFact.create({
      data: {
        userId: user.id,
        key: "housing",
        value: { value: "rent" },
        label: "You rent your home",
        source: "chat",
        confidence: 80,
        firstSeen: at(30),
        lastConfirmed: at(30),
      },
    });
    await client.janePreference.create({
      data: { userId: user.id, kind: "fact", key: "told:payday", label: "Payday is the 15th" },
    });
    await client.finding.create({
      data: {
        userId: user.id,
        type: "subscription_review",
        key: `merchant:gym-${who}`,
        title: "Review your gym",
        annualSavingsCents: 12_000,
        confidence: "high",
        evidence: {},
      },
    });
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    await client.transaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        source: "csv",
        dedupeKey: `${who}-tx`,
        date: new Date("2026-11-01T00:00:00Z"),
        amountCents: 185_000,
        description: "RENT PAYMENT",
        pfcPrimary: "RENT_AND_UTILITIES",
        categorySource: "rule",
      },
    });
    return user.id;
  };
  const counts = (userId: string) =>
    Promise.all([
      client.janeMessage.count({ where: { userId, kind: { in: ["user", "reply"] } } }),
      client.janeMessage.count({ where: { userId, kind: { notIn: ["user", "reply"] } } }),
      client.askConversation.count({ where: { userId } }),
      client.askMessage.count({ where: { userId } }),
      client.userFact.count({ where: { userId } }),
      client.janePreference.count({ where: { userId } }),
      client.finding.count({ where: { userId } }),
      client.transaction.count({ where: { userId } }),
    ]);

  beforeAll(async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    me = await seed("me");
    other = await seed("other");
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [me, other] } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("deletes every message, conversation and pin of the person, for good, and nothing else", async () => {
    expect(await counts(me)).toEqual([4, 2, 1, 1, 1, 1, 1, 1]);
    const cleared = await clearChat(me, { client });
    expect(cleared).toEqual({ messages: 4, conversations: 1, unpinned: 1 });
    // Logged as chat_cleared with counts only, and counted as an event.
    const [, event, , metadata] = vi.mocked(logAudit).mock.calls.at(-1)!;
    expect(event).toBe("chat_cleared");
    expect(metadata).toEqual({ messages: 4, conversations: 1, unpinned: 1 });
    expect(JSON.stringify(vi.mocked(logAudit).mock.calls)).not.toContain("Zorblax");
    expect(track).toHaveBeenCalledWith(me, "chat_cleared", { messages: 4, conversations: 1 });
    // Messages and conversations gone; memory, suggestions, cards and money data stay.
    expect(await counts(me)).toEqual([0, 2, 0, 0, 1, 1, 1, 1]);
    // The card that stays is no longer pinned, so no "Pinned" line is left over.
    const stillPinned = await client.janeMessage.count({
      where: { userId: me, refs: { path: ["pinned"], equals: true } },
    });
    expect(stillPinned).toBe(0);
    // Another person's chat is untouched, pins and all.
    expect(await counts(other)).toEqual([4, 2, 1, 1, 1, 1, 1, 1]);
    expect(
      await client.janeMessage.count({
        where: { userId: other, refs: { path: ["pinned"], equals: true } },
      }),
    ).toBe(2);
  });

  it("leaves nothing of the old chat for the next answer to quote", async () => {
    expect(await recentTurns(me, { client })).toEqual([]);
    const sent: string[] = [];
    const claude = () =>
      ({
        messages: {
          stream: (params: { messages: unknown[]; system?: unknown }) => {
            sent.push(JSON.stringify(params));
            const stream = {
              on: () => stream,
              abort() {},
              finalMessage: async () => ({
                stop_reason: "end_turn",
                content: [{ type: "text", text: "Hello again. Ask me anything about your money." }],
                usage: { input_tokens: 1, output_tokens: 1 },
              }),
            };
            return stream;
          },
        },
      }) as never;
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CHAT_MONTHLY_CAP_CENTS", "1000000000");
    await sendToJane(me, "hi there", { client, now: NOW, claude, primerMs: 60_000 });
    expect(sent.length).toBeGreaterThan(0);
    for (const call of sent) {
      expect(call).not.toContain("Zorblax");
      expect(call).not.toContain("that is your rent");
      expect(call).toContain("hi there");
    }
    // What Jane learned stays in its context: the memory still says they rent.
    expect(await client.userFact.count({ where: { userId: me, key: "housing" } })).toBe(1);
  });

  it("is harmless on a chat that is already empty", async () => {
    const empty = await client.user.create({
      data: { email: `clear-empty-${crypto.randomUUID()}@example.com` },
    });
    try {
      expect(await clearChat(empty.id, { client })).toEqual({
        messages: 0,
        conversations: 0,
        unpinned: 0,
      });
    } finally {
      await client.user.delete({ where: { id: empty.id } });
    }
  });
});
