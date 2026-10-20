import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadYearPlan } from "./year-plan";

// Spec step 205 against a real, migrated Postgres, with the demo bank: twelve months that
// fit the margin, kept, and a month that passed never changes while what was missed moves
// into the months ahead.

const url = process.env.TEST_DATABASE_URL;
const OCT = new Date("2026-10-16T15:00:00Z");
const NOV = new Date("2026-11-03T15:00:00Z");

describe.runIf(url)("the year's money plan", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  const created: string[] = [];
  const api = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `year-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    created.push(userId);
    const { itemId } = await linkDemoBank(userId, { client, now: OCT });
    await syncItem(itemId, { client, api, now: OCT });
    await client.savingsGoal.create({
      data: {
        userId,
        name: "Trip",
        targetCents: 240_000,
        targetDate: new Date("2027-08-01T00:00:00Z"),
        manualSavedCents: 0,
      },
    });
    await client.yearPlan.deleteMany({ where: { userId } });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("plans twelve months that fit the margin, and keeps them", async () => {
    const plan = (await loadYearPlan(userId, { client, now: OCT, keep: true }))!;
    expect(plan.months).toHaveLength(12);
    expect(plan.months[0].month).toBe("2026-10");
    for (const m of plan.months) {
      const flex = m.targets.saving + m.targets.debt + m.targets.investing;
      const fixed = m.targets.insurance + m.targets.taxes + m.targets.deadlines;
      expect(flex + fixed <= Math.max(m.marginCents, fixed), m.month).toBe(true);
    }
    expect(plan.months[0].targets.saving).toBeGreaterThan(0);
    expect(await client.yearPlan.count({ where: { userId } })).toBe(1);
  });

  it("a month that passed never changes; what was missed moves ahead", async () => {
    const before = (await loadYearPlan(userId, { client, now: OCT }))!;
    const next = (await loadYearPlan(userId, { client, now: NOV, keep: true }))!;
    expect(next.startMonth).toBe("2026-10");
    expect(next.months[0].targets).toEqual(before.months[0].targets);
    expect(next.months[0].actual).toEqual({ saving: 0, debt: 0, investing: 0 });
    // The catch-up arithmetic is the planner's (src/planning/year-plan.test.ts); here the
    // ahead months still fit and are re-planned.
    expect(next.months).toHaveLength(12);
    expect(await client.yearPlan.count({ where: { userId } })).toBe(1);
  });
});
