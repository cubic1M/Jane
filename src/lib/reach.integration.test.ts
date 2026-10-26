import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { reachReport } from "./reach";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const DAY = new Date("2026-10-18");

describe.runIf(url)("the reach scoreboard", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const users: string[] = [];

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const sample = await client.user.create({
      data: { id: `trial_reach${Date.now()}`, email: `r1-${crypto.randomUUID()}@try.jane.invalid` },
    });
    const real = await client.user.create({
      data: { email: `r2-${crypto.randomUUID()}@example.com` },
    });
    users.push(sample.id, real.id);
    const row = (userId: string, i: number, status: string, percent: number) => ({
      userId,
      key: `cost:bank_fees${i}`,
      capability: "cost",
      topic: "bank_fees",
      title: "t",
      worthCents: 10_000,
      worthKind: "saves",
      confidencePercent: percent,
      confidenceReason: "r",
      urgency: "soon",
      why: "w",
      actionLabel: "a",
      actionHref: "/x",
      status,
      selectedOn: DAY,
    });
    // Twelve answered at 90% sure where only 5 said yes: a detector running high.
    for (let i = 0; i < 12; i += 1) {
      await client.suggestion.create({ data: row(real.id, i, i < 5 ? "yes" : "no", 90) });
    }
    await client.suggestion.create({ data: row(sample.id, 99, "yes", 80) });
    // Never selected: not counted as reaching anyone.
    await client.suggestion.create({
      data: { ...row(real.id, 200, "waiting", 80), selectedOn: null },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  it("shows the eight people one by one, and everyone else in totals", async () => {
    const report = await reachReport({ client });
    expect(report.people).toHaveLength(8);
    // Bar 3: pass or fail per person.
    expect(report.topThree).toHaveLength(8);
    expect(report.topThree.every((t) => t.pass)).toBe(true);
    // Per tool: covered, exempt and missing add up to every tool.
    const c = report.coverage;
    expect(c.covered.length + c.exempt.length + c.missing.length).toBe(c.total);
    expect(c.covered.some((x) => x.tool === "company_stock")).toBe(true);
    expect(report.people.every((p) => p.wrong.length === 0)).toBe(true);
    expect(report.capabilities.map((c) => c.capability)).toContain("debt");
    expect(report.unreachable.map((u) => u.capability)).toContain("strategist");
    expect(report.real.byCapability.find((c) => c.capability === "cost")).toMatchObject({
      yes: 5,
      no: 7,
    });
    expect(report.sample.byCapability.find((c) => c.capability === "cost")).toMatchObject({
      yes: 1,
    });
    expect(report.real.offered).toBeGreaterThanOrEqual(12);
  });

  it("lists a detector whose percentages run high", async () => {
    const report = await reachReport({ client });
    const off = report.off.find((o) => o.detector === "cost:bank_fees");
    expect(off).toMatchObject({ direction: "high" });
    expect(report.bands.some((b) => b.from === 90)).toBe(true);
  });
});
