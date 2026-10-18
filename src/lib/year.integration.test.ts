import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { savedToDate } from "./membership/service";
import { yearInReview } from "./year";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-20T12:00:00Z");

describe.runIf(url)("year in review against a real database", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `year-${crypto.randomUUID()}@example.com` } })
    ).id;
    const finding = (key: string, createdAt: Date, annualSavingsCents: number) =>
      client.finding.create({
        data: {
          userId,
          type: "bank_fees",
          key,
          title: key,
          annualSavingsCents,
          confidence: "high",
          evidence: {},
          status: "done",
          createdAt,
        },
      });
    const done = async (key: string, completedAt: Date, cents: number, diy = false) => {
      const f = await finding(key, completedAt, cents);
      const decision = await client.decision.create({
        data: {
          userId,
          findingId: f.id,
          choice: diy ? "diy" : "yes",
          cardSnapshot: { annualSavingsCents: cents },
          diyDoneAt: diy ? completedAt : null,
        },
      });
      if (!diy) {
        await client.action.create({
          data: {
            userId,
            decisionId: decision.id,
            type: "recover_bank_fees",
            status: "done",
            completedAt,
          },
        });
      }
    };
    await done("team-2026", new Date("2026-03-01"), 10_000);
    await done("diy-2026", new Date("2026-05-01"), 5_000, true);
    await done("team-2025", new Date("2025-12-31T23:00:00Z"), 99_000);
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("counts what was saved and found in that year only", async () => {
    const review = await yearInReview(userId, 2026, { client, now: NOW });
    expect(review.savedCents).toBe(15_000);
    expect(review.found).toEqual({ findings: 2, annualSavingsCents: 15_000 });

    const last = await yearInReview(userId, 2025, { client, now: NOW });
    expect(last.savedCents).toBe(99_000);
  });

  it("adds up to saved-to-date across the years", async () => {
    const years = await Promise.all(
      [2025, 2026].map((y) => yearInReview(userId, y, { client, now: NOW })),
    );
    expect(years.reduce((sum, y) => sum + y.savedCents, 0)).toBe(
      await savedToDate(userId, { client }),
    );
  });
});
