import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { GoalError, addGoal, deleteGoal, listGoals, updateGoal } from "./goals";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-20T12:00:00Z");

describe.runIf(url)("savings goals against a real database", () => {
  let client: PrismaClient;
  const users: string[] = [];
  async function person() {
    const user = await client.user.create({
      data: { email: `goal-${crypto.randomUUID()}@example.com` },
    });
    users.push(user.id);
    const savings = await client.account.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Rainy Day Savings",
        type: "depository",
        subtype: "savings",
        currentBalanceCents: 150_000,
      },
    });
    return { id: user.id, savings };
  }
  const form = (overrides = {}) => ({
    name: "Emergency fund",
    target: "6000",
    targetDate: "2027-04-20",
    accountId: "",
    saved: "",
    ...overrides,
  });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  it("tracks a goal with a linked account's balance", async () => {
    const me = await person();
    await addGoal(me.id, form({ accountId: me.savings.id }), { client });

    const [goal] = await listGoals(me.id, { client, now: NOW });
    expect(goal).toMatchObject({
      accountName: "Rainy Day Savings",
      progress: { status: "on_the_way", savedCents: 150_000, monthsLeft: 6, monthlyCents: 75_000 },
    });
  });

  it("tracks by hand, and updates and deletes only the person's own goals", async () => {
    const me = await person();
    const other = await person();
    await addGoal(me.id, form({ saved: "1200" }), { client });
    const [goal] = await listGoals(me.id, { client, now: NOW });
    expect(goal.progress.savedCents).toBe(120_000);

    await expect(
      updateGoal(other.id, goal.id, form({ saved: "1" }), { client }),
    ).rejects.toBeInstanceOf(GoalError);
    await updateGoal(me.id, goal.id, form({ saved: "6000" }), { client });
    expect((await listGoals(me.id, { client, now: NOW }))[0].progress.status).toBe("reached");

    await deleteGoal(other.id, goal.id, { client });
    expect(await listGoals(me.id, { client, now: NOW })).toHaveLength(1);
    await deleteGoal(me.id, goal.id, { client });
    expect(await listGoals(me.id, { client, now: NOW })).toHaveLength(0);
  });

  it("won't link someone else's account or take bad input", async () => {
    const me = await person();
    const other = await person();
    for (const bad of [
      form({ accountId: other.savings.id }),
      form({ name: "" }),
      form({ target: "0" }),
      form({ targetDate: "soon" }),
      form({ saved: "-5" }),
    ]) {
      await expect(addGoal(me.id, bad, { client })).rejects.toBeInstanceOf(GoalError);
    }
  });
});
