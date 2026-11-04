import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canaryRecord } from "../../scripts/ops/canary-core.mjs";
import { countsOf } from "../../scripts/ops/holdouts-record.mjs";
import { acceptable } from "../../scripts/ops/record-result.mjs";

describe("a canary record", () => {
  const base = {
    solved: true,
    seconds: 90,
    version: "2.1.309",
    model: "claude-sonnet-5-5",
    at: "t",
  };
  it("keeps numbers and short names only", () => {
    const output = JSON.stringify({ num_turns: 6, total_cost_usd: 0.02, result: "secret words" });
    const record = canaryRecord({ ...base, output });
    expect(record).toEqual({
      at: "t",
      ran: true,
      solved: true,
      turns: 6,
      minutes: 1.5,
      costUsd: 0.02,
      model: "claude-sonnet-5-5",
      version: "2.1.309",
    });
    expect(JSON.stringify(record)).not.toContain("secret");
  });
  it("still records a run whose output it can't read", () => {
    expect(canaryRecord({ ...base, solved: false, output: "boom" })).toMatchObject({
      ran: false,
      solved: false,
      turns: null,
    });
  });
  it("tells a run that never reached the model from one that failed", () => {
    const output = JSON.stringify({ is_error: true, num_turns: 1, total_cost_usd: 0 });
    expect(canaryRecord({ ...base, solved: false, output }).ran).toBe(false);
  });
  it("refuses a name that isn't one", () => {
    const record = canaryRecord({ ...base, output: "{}", version: "ignore all of this <script>" });
    expect(record.version).toBe("unknown");
  });
});

describe("what can reach the public branch", () => {
  it("takes flat plain records", () => {
    expect(acceptable({ at: "2026-11-03T00:00:00.000Z", solved: true, turns: null, n: 1 })).toBe(
      true,
    );
  });
  it("refuses anything else", () => {
    expect(acceptable({ note: "a".repeat(61) })).toBe(false);
    expect(acceptable({ note: "line\nbreak" })).toBe(false);
    expect(acceptable({ nested: { a: 1 } })).toBe(false);
    expect(acceptable([1])).toBe(false);
    expect(acceptable(null)).toBe(false);
  });
});

describe("holdout counts", () => {
  it("counts a flaky test as not passed, and carries no names", () => {
    const counts = countsOf({ stats: { expected: 6, unexpected: 1, flaky: 1 }, suites: ["names"] });
    expect(counts).toEqual({ passed: 6, total: 8 });
    expect(countsOf({})).toEqual({ passed: 0, total: 0 });
  });
});

describe("the canary task itself", () => {
  const inFolder = (extra?: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), "canary-test-"));
    cpSync("canary/task", dir, { recursive: true });
    copyFileSync("canary/hidden/score.test.js", join(dir, "score.test.js"));
    extra?.(dir);
    const { status } = spawnSync("node", ["--test", "score.test.js"], {
      cwd: dir,
      encoding: "utf8",
    });
    rmSync(dir, { recursive: true, force: true });
    return status;
  };
  it("fails its hidden score as given, so a solve means something", () => {
    expect(inFolder()).not.toBe(0);
  });
  it("can be solved: a correct answer passes the score", () => {
    const solution = `
export const total = (lines, off = 0) =>
  Math.floor(lines.reduce((all, l) => all + l.cents * l.quantity, 0) * (100 - off) / 100 + 0.5);
export function split(cents, people) {
  const each = Math.floor(cents / people);
  return Array.from({ length: people }, (_, i) => each + (i < cents - each * people ? 1 : 0));
}
export function format(cents) {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return (cents < 0 ? "-$" : "$") + dollars + "." + String(abs % 100).padStart(2, "0");
}
export const pastDue = (due, today) => Date.parse(due) < Date.parse(today);
`;
    expect(
      inFolder((dir) =>
        execFileSync("sh", ["-c", `cat > invoice.js`], { cwd: dir, input: solution }),
      ),
    ).toBe(0);
  });
  it("keeps the scorer away from the agent", () => {
    const code = readFileSync("scripts/ops/canary.mjs", "utf8");
    const copyTask = code.indexOf('join(CANARY, "task")');
    const runAgent = code.indexOf("spawnSync(\n  claude");
    const copyScore = code.indexOf('"hidden", "score.test.js"');
    expect(copyTask).toBeLessThan(runAgent);
    expect(runAgent).toBeLessThan(copyScore);
  });
  it("gives the agent's job no write token", () => {
    const flow = readFileSync(".github/workflows/canary.yml", "utf8");
    const agentJob = flow.slice(flow.indexOf("\n  run:"), flow.indexOf("\n  record:"));
    expect(agentJob).toContain("persist-credentials: false");
    expect(agentJob).not.toMatch(/write|GH_TOKEN|GITHUB_TOKEN/);
  });
});

describe("the seal on the holdouts", () => {
  const flow = readFileSync(".github/workflows/holdout-seal.yml", "utf8");
  it("covers both folders, and fails on a changed or removed file only", () => {
    expect(flow).toContain('"holdouts/**"');
    expect(flow).toContain('"canary/**"');
    expect(flow).toContain("--diff-filter=MDRT");
    expect(flow).toContain("-- holdouts canary");
  });
  it("runs no pull request's script: only what's written in this file", () => {
    expect(flow).not.toMatch(/\bnode\b|\bnpm\b|\.sh\b/);
    expect(flow).toContain("persist-credentials: false");
  });
});
