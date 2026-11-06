import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { GoalError, addGoal } from "./goals";

// Goals had no limit, and a partner's joint ones go into the other partner's chat each time it
// looks at money for two. Against a real Postgres.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("how many goals a person keeps", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({ data: { email: `goals-cap-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("stops at 50, and says why", async () => {
    const goal = (i: number) => ({
      name: `Goal ${i}`,
      target: "1000",
      targetDate: "2030-01-01",
      accountId: "",
      saved: "",
    });
    for (let i = 0; i < 50; i += 1) await addGoal(userId, goal(i), { client });
    await expect(addGoal(userId, goal(50), { client })).rejects.toBeInstanceOf(GoalError);
    expect(await client.savingsGoal.count({ where: { userId } })).toBe(50);
  });
});
