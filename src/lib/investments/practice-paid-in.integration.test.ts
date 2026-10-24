import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { addPracticeMoney, startPractice } from "@/lib/practice/portfolio";
import { practicePaidIn } from "./practice-paid-in";

// The practice money that went in (visitor walk): the start and every add, never another
// person's, so up or down is against all of it.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-17T15:00:00Z");

describe.runIf(url)("practice money put in", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async () => {
    const user = await client.user.create({
      data: { email: `paid-in-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("adds the starting money and each add, for this person only", async () => {
    const userId = await person();
    const other = await person();
    expect(await practicePaidIn(userId, { client })).toBe(0);
    await startPractice(userId, 3, { client, now: NOW });
    await startPractice(other, 3, { client, now: NOW });
    const start = await practicePaidIn(userId, { client });
    expect(start).toBeGreaterThan(0);
    await addPracticeMoney(userId, 50_000, "Your monthly practice money.", "monthly_add", {
      client,
      now: NOW,
    });
    expect(await practicePaidIn(userId, { client })).toBe(start + 50_000);
    expect(await practicePaidIn(other, { client })).toBe(start);
  });
});
