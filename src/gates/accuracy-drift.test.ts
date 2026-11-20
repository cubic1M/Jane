import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { driftOf, driftReport, pushDriftWarning } from "../../scripts/accuracy-drift-core.mjs";

// npm run accuracy:drift and the push warning (manager 11-20): CI's gate compares only the
// baseline files, so #1852 moved dollarError in all five CSV sets without anything going red.
// The drift compares the scoreboards with the baselines by CI's own rule, and a push that changes
// what they read warns, never stops.

const FILE = "src/accuracy/csv/baseline.json";
const committed = { [FILE]: { "held-out": { dollarError: 0.0075, "bills.recall": 0.99 } } };

describe("npm run accuracy:drift's report", () => {
  it("reports a made-up fall and exits 1", () => {
    const drift = driftOf(committed, {
      [FILE]: { "held-out": { dollarError: 0.0131, "bills.recall": 0.99 } },
    });
    expect(drift.falls).toEqual([
      { file: FILE, path: "held-out / dollarError", was: 0.0075, now: 0.0131 },
    ]);
    const report = driftReport(drift);
    expect(report.exitCode).toBe(1);
    expect(report.text).toMatch(/FELL .*held-out \/ dollarError 0\.0075 → 0\.0131/);
    expect(report.text).toMatch(/first line.*auto-merge off/);
  });

  it("reports a rise and exits 0", () => {
    const drift = driftOf(committed, {
      [FILE]: { "held-out": { dollarError: 0, "bills.recall": 1 } },
    });
    expect(drift.falls).toEqual([]);
    expect(drift.rises.map((r) => r.path).sort()).toEqual([
      "held-out / bills.recall",
      "held-out / dollarError",
    ]);
    const report = driftReport(drift);
    expect(report.exitCode).toBe(0);
    expect(report.text).toMatch(/ROSE .*held-out \/ dollarError 0\.0075 → 0/);
  });

  it("calls a score that left the file a fall", () => {
    expect(driftReport(driftOf(committed, { [FILE]: { "held-out": {} } })).exitCode).toBe(1);
  });
});

describe("the push warning's rule", () => {
  const head = "abc123";
  const changed = ["src/detectors/money.ts"];

  it("says nothing for a branch the scoreboards don't read", () => {
    expect(
      pushDriftWarning({ changedPaths: ["src/app/home/page.tsx"], head, record: null }),
    ).toBeNull();
  });

  it("warns until the drift ran on the last commit, and about a fall it found", () => {
    expect(pushDriftWarning({ changedPaths: changed, head, record: null })).toMatch(
      /accuracy:drift hasn't run/,
    );
    expect(
      pushDriftWarning({
        changedPaths: changed,
        head,
        record: JSON.stringify({ head: "old", falls: [] }),
      }),
    ).toMatch(/hasn't run/);
    expect(
      pushDriftWarning({
        changedPaths: changed,
        head,
        record: JSON.stringify({
          head,
          falls: [{ path: "held-out / dollarError", was: 0.0075, now: 0.0131 }],
        }),
      }),
    ).toMatch(/accuracy fell.*held-out \/ dollarError 0\.0075 → 0\.0131.*auto-merge off/);
    expect(
      pushDriftWarning({
        changedPaths: changed,
        head,
        record: JSON.stringify({ head, falls: [] }),
      }),
    ).toBeNull();
  });
});

// The hook itself, on a real push of a branch that changes a detector: shown, and not refused.
const HOOK = resolve(".claude/hooks/deny.mjs");

describe("pushing a detector change", () => {
  it("warns, and the push goes on", () => {
    const dir = mkdtempSync(join(tmpdir(), "deny-drift-"));
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
        { encoding: "utf8" },
      ).trim();
    git("init", "-q", "-b", "main");
    writeFileSync(join(dir, "README.md"), "x\n");
    git("add", "-A");
    git("commit", "-qm", "base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("switch", "-qc", "claude/lane");
    mkdirSync(join(dir, "src/detectors"), { recursive: true });
    writeFileSync(join(dir, "src/detectors/money.ts"), "// changed\n");
    git("add", "-A");
    git("commit", "-qm", "change");
    const push = () =>
      spawnSync("node", [HOOK], {
        input: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "git push -u origin claude/lane" },
          cwd: dir,
        }),
        encoding: "utf8",
      });
    const before = push();
    expect(before.status).toBe(0);
    expect(JSON.parse(before.stdout).systemMessage).toMatch(/accuracy:drift hasn't run/);
    writeFileSync(
      resolve(dir, git("rev-parse", "--git-path", "accuracy-drift")),
      `${JSON.stringify({ head: git("rev-parse", "HEAD"), falls: [] })}\n`,
    );
    const after = push();
    expect(after.status).toBe(0);
    expect(after.stdout).toBe("");
  });
});
