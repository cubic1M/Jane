import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { loadDebts } from "./debts";

// Debugger 11-16 (r319, a phone walk at 10:47pm in Los Angeles): a student typed what's left on
// Nelnet, and the chat said "you typed it on Nov 17, 2026", UTC's day. The day a figure was typed
// is the person's own day, as the rest of the book is.

const url = process.env.TEST_DATABASE_URL;
// 10:47pm on Nov 16 in Los Angeles, already Nov 17 in UTC.
const TYPED_AT = new Date("2026-11-17T06:47:00Z");

describe.runIf(url)("the day a loan's terms were typed", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `debts-typed-day-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
    const loan = await client.account.create({
      data: { userId, source: "csv", name: "Car loan", type: "loan", subtype: "auto" },
    });
    await client.debtTerms.create({
      data: {
        userId,
        debtKey: `account:${loan.id}`,
        aprBps: 550,
        balanceCents: 1_840_000,
        createdAt: TYPED_AT,
        updatedAt: TYPED_AT,
      },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("is their day, not UTC's", async () => {
    const [debt] = (await loadDebts(userId, { client, now: TYPED_AT })).debts;
    expect(debt?.typedOn).toBe("2026-11-16");
  });
});
