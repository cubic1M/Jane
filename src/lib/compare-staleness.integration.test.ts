import { afterAll, describe, expect, it, vi } from "vitest";

// A savings rate checked more than SAVINGS_APY_STALE_DAYS ago isn't compared; other plans keep the
// 90-day limit (connectors roadmap round 13).

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});

import { OPTION_STALE_DAYS, SAVINGS_APY_STALE_DAYS } from "@/config/compare";
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { usableOptions } from "./compare";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: options to compare, nobody's own", db);
const DAY = 86_400_000;

describe.runIf(url)("how long an option's price is used", () => {
  const ids: string[] = [];
  const now = new Date("2026-11-06T12:00:00Z");
  const daysAgo = (n: number) =>
    new Date(`${new Date(now.getTime() - n * DAY).toISOString().slice(0, 10)}T00:00:00Z`);

  afterAll(async () => {
    await system().switchOption.deleteMany({ where: { id: { in: ids } } });
  });

  async function option(kind: "savings" | "plan", checkedDaysAgo: number) {
    const row = await system().switchOption.create({
      data: {
        kind,
        category: kind === "savings" ? "savings" : "phone",
        provider: `Test ${crypto.randomUUID()}`,
        name: `${kind} checked ${checkedDaysAgo} days ago`,
        ...(kind === "savings" ? { apyBps: 400 } : { monthlyCents: 3_000 }),
        sourceUrl: "https://example.com/rates",
        checkedAt: daysAgo(checkedDaysAgo),
        reviewedAt: now,
      },
    });
    ids.push(row.id);
    return row.id;
  }

  it("drops a savings rate after a week, and keeps a phone plan's price for 90 days", async () => {
    const freshSavings = await option("savings", SAVINGS_APY_STALE_DAYS - 1);
    const staleSavings = await option("savings", SAVINGS_APY_STALE_DAYS + 1);
    const monthOldPlan = await option("plan", 30);
    const oldPlan = await option("plan", OPTION_STALE_DAYS + 1);
    const used = new Set((await usableOptions({ now })).map((o) => o.id));
    expect(used.has(freshSavings)).toBe(true);
    expect(used.has(staleSavings)).toBe(false);
    expect(used.has(monthOldPlan)).toBe(true);
    expect(used.has(oldPlan)).toBe(false);
  });
});
