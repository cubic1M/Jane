import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import type { ScenarioRun } from "@/planning/what-if";
import { adoptedPlans, adoptPlan } from "./what-if";

// CodeRabbit sweep 1c (lib-03): adopting a plan drops the old one and saves the new one as a
// single step, so a save that fails leaves the old plan adopted.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");

describe.runIf(url)("adopting a what-if plan", () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `whatif-adopt-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("keeps the old plan adopted when the new one can't be saved", async () => {
    await client.whatIfPlan.create({
      data: { userId, scenario: "job_loss", params: {}, changes: [], createdAt: NOW },
    });
    const broken = {
      scenario: "job_loss",
      params: { months: 3 },
      plan: [],
    } as unknown as ScenarioRun;
    // An invalid date makes the insert fail after the old plan was dropped (in the old code).
    await expect(
      adoptPlan(userId, broken, { client, now: new Date("not a date") }),
    ).rejects.toThrow();
    const plans = await adoptedPlans(userId, { client });
    expect(plans.map((p) => p.scenario)).toEqual(["job_loss"]);
  });

  it("replaces the plan for a scenario with the new one", async () => {
    await client.whatIfPlan.deleteMany({ where: { userId } });
    await client.whatIfPlan.create({
      data: { userId, scenario: "job_loss", params: {}, changes: [], createdAt: NOW },
    });
    const run = { scenario: "job_loss", params: { months: 3 }, plan: [] } as unknown as ScenarioRun;
    await adoptPlan(userId, run, { client, now: NOW });
    expect(await adoptedPlans(userId, { client })).toHaveLength(1);
    expect(await client.whatIfPlan.count({ where: { userId, status: "dropped" } })).toBe(1);
  });
});
