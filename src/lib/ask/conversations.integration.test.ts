import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { deleteAllData } from "@/lib/account-deletion";
import {
  ConversationMissingError,
  deleteConversation,
  historyFor,
  saveExchange,
} from "./conversations";

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("Ask Jane conversations against a real database", () => {
  let client: PrismaClient;
  const users: string[] = [];
  const person = async () => {
    const user = await client.user.create({
      data: { email: `askconv-${crypto.randomUUID()}@example.com` },
    });
    users.push(user.id);
    return user.id;
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  it("keeps each person's conversations to themselves", async () => {
    const me = await person();
    const other = await person();
    const id = await saveExchange(
      me,
      null,
      "Food?",
      { kind: "answer", text: "$12.00" },
      { client },
    );

    expect(await historyFor(me, id, { client })).toEqual([
      { role: "user", content: "Food?" },
      { role: "assistant", content: "$12.00" },
    ]);
    await expect(historyFor(other, id, { client })).rejects.toBeInstanceOf(
      ConversationMissingError,
    );
    expect(await deleteConversation(other, id, { client })).toBe(false);
    expect(await deleteConversation(me, id, { client })).toBe(true);
    expect(await client.askMessage.count({ where: { conversationId: id } })).toBe(0);
  });

  it("marks a blocked answer as blocked", async () => {
    const me = await person();
    const id = await saveExchange(
      me,
      null,
      "Food?",
      { kind: "blocked", text: "Sorry", issues: ["unsupported_dollar_figure"] },
      { client },
    );
    const messages = await client.askMessage.findMany({ where: { conversationId: id } });
    expect(messages.find((m) => m.role === "assistant")?.blocked).toBe(true);
  });

  it("removes every conversation on Delete all my data", async () => {
    const me = await person();
    await saveExchange(me, null, "Food?", { kind: "answer", text: "Hi" }, { client });

    await deleteAllData(me, { client, api: {} as never });

    expect(await client.askConversation.count({ where: { userId: me } })).toBe(0);
    expect(await client.askMessage.count({ where: { userId: me } })).toBe(0);
  });
});
