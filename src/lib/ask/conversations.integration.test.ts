import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { deleteAllData } from "@/lib/account-deletion";
import { deleteConversation } from "./conversations";

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

// Earlier Ask Jane conversations, kept to read and delete (docs/feature-audit.md, cluster 5).
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

  // A conversation from before the chat answered everything.
  const conversation = async (userId: string) => {
    const { id } = await client.askConversation.create({ data: { userId, title: "Food?" } });
    await client.askMessage.createMany({
      data: [
        { userId, conversationId: id, role: "user", content: "Food?" },
        { userId, conversationId: id, role: "assistant", content: "$12.00" },
      ],
    });
    return id;
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  it("lets only the person delete their own", async () => {
    const me = await person();
    const other = await person();
    const id = await conversation(me);
    expect(await deleteConversation(other, id, { client })).toBe(false);
    expect(await client.askMessage.count({ where: { conversationId: id } })).toBe(2);
    expect(await deleteConversation(me, id, { client })).toBe(true);
    expect(await client.askMessage.count({ where: { conversationId: id } })).toBe(0);
  });

  it("removes every conversation on Delete all my data", async () => {
    const me = await person();
    await conversation(me);

    await deleteAllData(me, { client, api: {} as never });

    expect(await client.askConversation.count({ where: { userId: me } })).toBe(0);
    expect(await client.askMessage.count({ where: { userId: me } })).toBe(0);
  });
});
