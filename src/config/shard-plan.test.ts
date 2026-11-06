import { describe, expect, it } from "vitest";
import { shardPlan } from "../../scripts/shard-plan-core.mjs";

describe("shards by time", () => {
  const files = Array.from({ length: 200 }, (_, i) => `src/${i}.test.ts`);
  const timings = Object.fromEntries(files.map((file, i) => [file, (i % 17) * 1000 + 50]));

  it("runs every file exactly once", () => {
    const plan = shardPlan(files, timings, 4);
    const all = plan.flatMap((shard: { files: string[] }) => shard.files);
    expect(all.toSorted()).toEqual(files.toSorted());
  });

  it("evens out what name order wouldn't", () => {
    const skewed = { ...timings, "src/0.test.ts": 100_000 };
    const plan = shardPlan(files, skewed, 4);
    const times = plan.map((shard: { ms: number }) => shard.ms);
    expect(Math.max(...times) - Math.min(...times)).toBeLessThanOrEqual(100_000);
    const rest = plan.filter((s: { files: string[] }) => !s.files.includes("src/0.test.ts"));
    const restTimes = rest.map((shard: { ms: number }) => shard.ms);
    expect(Math.max(...restTimes) - Math.min(...restTimes)).toBeLessThanOrEqual(16_000);
  });

  it("every shard gets the same answer", () => {
    expect(shardPlan(files, timings, 4)).toEqual(shardPlan(files.toReversed(), timings, 4));
  });

  it("a new file counts as the middle one, and no timings at all still splits evenly", () => {
    const plan = shardPlan(
      ["new.test.ts", "a.test.ts", "b.test.ts"],
      { "a.test.ts": 10, "b.test.ts": 30 },
      1,
    );
    expect(plan[0].ms).toBe(70);
    const blind = shardPlan(files, {}, 4);
    for (const shard of blind) expect(shard.files).toHaveLength(50);
  });
});
