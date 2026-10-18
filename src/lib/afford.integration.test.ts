import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { affordCheck } from "@/planning/afford";
import { loadAffordNumbers } from "./afford";
import { homeSummary } from "./home";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-20T12:00:00Z");

describe.runIf(url)("can-I-afford-this numbers against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let emptyId: string;

  beforeAll(async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const suffix = crypto.randomUUID();
    userId = (await client.user.create({ data: { email: `afford-${suffix}@example.com` } })).id;
    emptyId = (await client.user.create({ data: { email: `afford0-${suffix}@example.com` } })).id;
    const account = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 200_000,
      },
    });
    // Netflix on the 15th of each month: a regular bill from checking.
    await client.transaction.createMany({
      data: ["2026-07-15", "2026-08-15", "2026-09-15", "2026-10-15"].map((d) => ({
        userId,
        accountId: account.id,
        source: "csv" as const,
        dedupeKey: `n-${d}`,
        date: new Date(`${d}T00:00:00Z`),
        amountCents: 1549,
        description: "NETFLIX.COM",
        pfcPrimary: "ENTERTAINMENT",
        pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
        categorySource: "rule" as const,
      })),
    });
    await client.savingsGoal.create({
      data: {
        userId,
        name: "Trip",
        targetCents: 120_000,
        manualSavedCents: 0,
        targetDate: new Date("2027-10-20T00:00:00Z"),
      },
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [userId, emptyId] } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("uses Home's safe to spend, the checking bills ahead and the goals", async () => {
    const [numbers, home] = await Promise.all([
      loadAffordNumbers(userId, { client, now: NOW }),
      homeSummary(userId, { client, now: NOW }),
    ]);
    expect(numbers.asOf).toBe("2026-10-20");
    expect(numbers.safe).toEqual({
      payday: home?.safeToSpend?.payday,
      balanceCents: 200_000,
      safeCents: home?.safeToSpend?.safeCents,
    });
    // Netflix from Nov 15, 2026 through Sep 15, 2027: the last month shown.
    expect(numbers.flows).toHaveLength(11);
    expect(numbers.flows[0]).toEqual({ date: "2026-11-15", amountCents: -1549 });
    expect(numbers.goals).toEqual([
      expect.objectContaining({ name: "Trip", targetCents: 120_000, savedCents: 0 }),
    ]);

    const result = affordCheck(numbers, {
      kind: "purchase",
      amountCents: 10_000,
      date: "2026-10-20",
    });
    expect(result.months?.[11]).toEqual({
      month: "2027-09",
      beforeCents: 200_000 - 11 * 1549,
      afterCents: 190_000 - 11 * 1549,
    });
  });

  it("has no checking numbers for someone without accounts", async () => {
    expect(await loadAffordNumbers(emptyId, { client, now: NOW })).toEqual({
      asOf: "2026-10-20",
      safe: null,
      flows: [],
      goals: [],
    });
  });
});
