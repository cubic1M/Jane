import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { moneyFound, runDetection } from "@/detection/engine";
import { homeSummary } from "./home";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-15T12:00:00Z");

describe.runIf(url)("home summary against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let emptyId: string;

  beforeAll(async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const suffix = crypto.randomUUID();
    userId = (await client.user.create({ data: { email: `home-${suffix}@example.com` } })).id;
    emptyId = (await client.user.create({ data: { email: `empty-${suffix}@example.com` } })).id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    const day = (d: string) => new Date(`${d}T00:00:00Z`);
    await client.transaction.createMany({
      data: [
        ...["2026-07-15", "2026-08-15", "2026-09-15", "2026-10-15"].map((d) => ({
          userId,
          accountId: account.id,
          source: "csv" as const,
          dedupeKey: `n-${d}`,
          date: day(d),
          amountCents: 1549,
          description: "NETFLIX.COM",
          pfcPrimary: "ENTERTAINMENT",
          pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
          categorySource: "rule" as const,
        })),
        {
          userId,
          accountId: account.id,
          source: "csv" as const,
          dedupeKey: "fee",
          date: day("2026-09-01"),
          amountCents: 3400,
          description: "OVERDRAFT FEE",
          pfcPrimary: "BANK_FEES",
          pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
          categorySource: "rule" as const,
        },
      ],
    });
    await runDetection(userId, { client, now: NOW });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [userId, emptyId] } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("is null for someone without accounts", async () => {
    expect(await homeSummary(emptyId, { client, now: NOW })).toBeNull();
  });

  it("matches the report's numbers and lists what's new and coming up", async () => {
    const home = await homeSummary(userId, { client, now: NOW });

    expect(home?.moneyFoundCents).toBe(await moneyFound(userId, { client }));
    expect(home?.savedToDateCents).toBe(0);
    expect(home?.newestFindings.map((f) => f.title).sort()).toEqual([
      "$34.00 in fees on Checking in the last 12 months",
      "Review your Netflix subscription",
    ]);
    expect(home?.upcoming).toEqual([
      { merchant: "Netflix", date: "2026-11-14", amountCents: 1549 },
    ]);
    expect(home?.lastUpdated).toBeInstanceOf(Date);
  });
});
