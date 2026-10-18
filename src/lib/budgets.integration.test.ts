import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { BudgetError, removeBudget, setBudget } from "./budgets";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("budgets against a real database", () => {
  let client: PrismaClient;
  const users: string[] = [];
  const person = async () => {
    const user = await client.user.create({
      data: { email: `budget-${crypto.randomUUID()}@example.com` },
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

  it("sets, changes and removes a person's own budget", async () => {
    const me = await person();
    const other = await person();
    await setBudget(me, "Food and drink", "400", { client });
    await setBudget(me, "Food and drink", "$450.50", { client });
    await setBudget(other, "Food and drink", "100", { client });

    expect(
      await client.budget.findMany({
        where: { userId: me },
        select: { category: true, amountCents: true },
      }),
    ).toEqual([{ category: "Food and drink", amountCents: 45_050 }]);
    await removeBudget(me, "Food and drink", { client });
    expect(await client.budget.count({ where: { userId: me } })).toBe(0);
    expect(await client.budget.count({ where: { userId: other } })).toBe(1);
  });

  it("refuses unknown categories and silly amounts", async () => {
    const me = await person();
    for (const [category, amount] of [
      ["Income", "100"],
      ["Made up", "100"],
      ["Food and drink", "0"],
      ["Food and drink", "lots"],
    ]) {
      await expect(setBudget(me, category, amount, { client })).rejects.toBeInstanceOf(BudgetError);
    }
  });
});
