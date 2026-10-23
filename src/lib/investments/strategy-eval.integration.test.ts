import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { latestStrategies, type ChosenStrategy } from "./strategy-eval";

// The weekly evaluation's results against a real, migrated Postgres: the latest run's choice per
// level reads back as it was saved.

const url = process.env.TEST_DATABASE_URL;
const metrics = {
  from: "2016-01-04",
  to: "2021-12-31",
  cagr: 0.06,
  vol: 0.05,
  maxDrawdown: 0.06,
  sortino: 1.5,
  turnover: 3,
  costShare: 0.001,
  rebalances: 70,
};
const chosen = (level: 1 | 2 | 3 | 4 | 5, key: string): ChosenStrategy => ({
  level,
  id: key.startsWith("trend") ? "trend" : "static",
  params: key.startsWith("trend") ? { months: 6 } : { rebalance: "band" },
  key,
  label: key.startsWith("trend") ? "Trend filter" : "The level's mix",
  why: "Because.",
  train: metrics,
  test: metrics,
  baseline: { train: metrics, test: metrics },
});

describe.runIf(url)("latestStrategies", () => {
  let client: PrismaClient;
  const ids: string[] = [];
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.strategyEvaluation.deleteMany({ where: { id: { in: ids } } });
    await client.$disconnect();
  });

  it("reads back the latest run's choice per level", async () => {
    for (const [ranAt, key] of [
      ["2099-01-05T11:00:00Z", "static(rebalance=band)"],
      ["2099-01-12T11:00:00Z", "trend(months=6)"],
    ] as const) {
      const row = await client.strategyEvaluation.create({
        data: {
          ranAt: new Date(ranAt),
          source: "alpaca",
          fromDate: new Date("2016-01-04T00:00:00Z"),
          toDate: new Date("2099-01-09T00:00:00Z"),
          chosen: [chosen(1, key), chosen(5, "static(rebalance=band)")],
          results: [],
        },
        select: { id: true },
      });
      ids.push(row.id);
    }
    const latest = (await latestStrategies({ client }))!;
    expect(latest.source).toBe("alpaca");
    expect(latest.to).toBe("2099-01-09");
    expect(latest.byLevel[1]?.key).toBe("trend(months=6)");
    expect(latest.byLevel[1]?.params).toEqual({ months: 6 });
    expect(latest.byLevel[5]?.label).toBe("The level's mix");
    expect(latest.byLevel[3]).toBeUndefined();
  });
});
