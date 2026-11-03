import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Integration tests share one database. startTrial without `defer` cleans up every expired sample
// person in it, which deleted other test files' people mid-test: from the memory test (10-29), and
// from a trial dated 2031 (11-03). Only the file CI runs alone may do that.
const RUNS_ALONE = new Set(["src/lib/trial.integration.test.ts"]);

const integrationTests = readdirSync("src", { recursive: true })
  .map((file) => join("src", String(file)))
  .filter((file) => /\.integration\.test\.tsx?$/.test(file));

describe("test files sharing a database", () => {
  it("don't clean up everyone's sample people", () => {
    const offenders = integrationTests.filter((file) => {
      if (RUNS_ALONE.has(file)) return false;
      const calls = readFileSync(file, "utf8").match(/\bstartTrial\((\{[\s\S]*?\})?\)/g) ?? [];
      return calls.some((call) => !call.includes("defer"));
    });
    expect(offenders).toEqual([]);
  });
});
