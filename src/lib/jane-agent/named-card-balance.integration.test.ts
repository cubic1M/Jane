import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { sendToJane } from "./typing";

// Debugger 11-18 (r344, Plaid S2: checking and a Discover card owing $1,890 at 27.24%): "what's my
// discover card balance?" answered "I can't answer that one yet", though "what's my card balance?"
// gives it, and "what do i owe on my credit card" listed the bills coming up instead.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T11:40:00Z");

describe.runIf(url)("a card's balance, asked by its name", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: { email: `named-card-balance-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    await client.account.create({
      data: {
        userId,
        source: "plaid",
        name: "Discover it Card",
        mask: "1234",
        type: "credit",
        subtype: "credit card",
        currentBalanceCents: 189_000,
      },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  const ask = async (text: string) =>
    (await sendToJane(userId, text, { client, now: NOW })).reply.body;

  it("answers with what's owed on it", async () => {
    for (const question of [
      "what's my discover card balance?",
      "what do i owe on my credit card",
    ]) {
      expect(await ask(question)).toContain("$1,890.00");
    }
  });
});
