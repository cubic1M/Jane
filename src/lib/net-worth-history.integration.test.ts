import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { loadNetWorthHistory } from "./net-worth-history";

// Overnight upload QA: statements without a balance column left every balance unknown, and
// Home said "Net worth $0 · Your line starts today".
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-27T18:00:00Z");

describe.runIf(url)("whether net worth is known", () => {
  let client: PrismaClient;
  const users: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  const person = async (balances: (number | null)[]) => {
    const user = await client.user.create({
      data: { email: `worth-${crypto.randomUUID()}@example.com` },
    });
    users.push(user.id);
    for (const [i, b] of balances.entries()) {
      await client.account.create({
        data: {
          userId: user.id,
          source: "csv",
          name: `Account ${i}`,
          type: i === 0 ? "depository" : "credit",
          subtype: i === 0 ? "checking" : "credit card",
          currentBalanceCents: b,
        },
      });
    }
    return user.id;
  };

  it("isn't known when no account has a balance", async () => {
    const history = await loadNetWorthHistory(await person([null, null]), { client, now: NOW });
    expect(history?.known).toBe(false);
  });

  it("is known once one account has a balance", async () => {
    const history = await loadNetWorthHistory(await person([250_000, null]), {
      client,
      now: NOW,
    });
    expect(history?.known).toBe(true);
    expect(history?.todayCents).toBe(250_000);
  });
});
