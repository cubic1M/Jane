import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every database round trip pays the distance between the function and Neon, and a page makes
// hundreds (docs/perf/first-load.md). Neon is in AWS us-west-2, and pdx1 (Portland) is Vercel's region
// in it. Left unset, functions run in iad1 (Washington), about 65 ms from the database per round
// trip: Home took 4 to 6 seconds. The free plan allows one region.
describe("where the functions run", () => {
  it("is pdx1, next to the database, and only there", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { regions?: string[] };
    expect(config.regions).toEqual(["pdx1"]);
  });
});
