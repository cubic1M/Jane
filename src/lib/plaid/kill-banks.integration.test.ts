import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlaidApi } from "plaid";
import { PrismaClient } from "@/generated/prisma/client";
import { encrypt } from "@/lib/crypto";
import { syncItem } from "@/lib/plaid/sync";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

const url = process.env.TEST_DATABASE_URL;

// KILL_BANKS (docs/incident.md): every sync goes through syncItem, so nothing reads a real bank.
describe.runIf(url)("KILL_BANKS against a real database", () => {
  let client: PrismaClient;
  const userId = "kill-banks-person";

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    await client.user.deleteMany({ where: { id: userId } });
    await client.user.create({ data: { id: userId, email: "kill-banks@example.com" } });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("reaches Plaid only when it's off", async () => {
    const item = await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: "kill-banks-item",
        accessTokenEncrypted: encrypt("access-sandbox-kill-banks"),
      },
    });
    const reached = new Error("reached Plaid");
    const api = new Proxy({} as PlaidApi, {
      get: () => () => Promise.reject(reached),
    });
    vi.stubEnv("KILL_BANKS", "1");
    await expect(syncItem(item.id, { client, api })).rejects.toThrow("Bank syncing is paused");
    vi.stubEnv("KILL_BANKS", "");
    await expect(syncItem(item.id, { client, api })).rejects.not.toThrow("Bank syncing is paused");
  });
});
