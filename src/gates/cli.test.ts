import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The gates as CI runs them: the real script, on real commits in a throwaway repo.
const CLI = resolve(".github/scripts/gates/cli.mjs");

describe("the gates, on real commits", () => {
  let repo = "";
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), text);
  };
  const commit = (env: object = {}) => {
    git("add", "-A");
    execFileSync("git", ["-C", repo, "commit", "-qm", "change"], {
      stdio: "pipe",
      env: { ...process.env, ...env },
    });
    return git("rev-parse", "HEAD");
  };
  const judge = (
    base: string,
    pr: object = {},
    env: Record<string, string> = {},
    head = "HEAD",
  ) => {
    const prFile = join(repo, "..", `${repo.split("/").pop()}.pr.json`);
    writeFileSync(
      prFile,
      JSON.stringify({ title: "x", body: "", branch: "lane", labels: [], author: "shared", ...pr }),
    );
    const result = spawnSync(
      process.execPath,
      [CLI, "--pr-json", prFile, "--base", base, "--head", head],
      {
        cwd: repo,
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: "/tmp", ...env } as unknown as NodeJS.ProcessEnv,
      },
    );
    rmSync(prFile);
    return result;
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "gates-cli-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.test");
    git("config", "user.name", "t");
    git("config", "core.quotePath", "true");
    write("README.md", "first\n");
    write("package.json", JSON.stringify({ version: "1", scripts: { test: "vitest run" } }));
    write("src/accuracy/baseline.json", JSON.stringify({ tuning: { bills: { recall: 1 } } }));
    write("src/a.test.ts", 'it("adds", () => {\n  expect(1 + 1).toBe(2);\n});\n'.repeat(20));
    commit();
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("passes a plain change", () => {
    const base = git("rev-parse", "HEAD");
    write("README.md", "second\n");
    commit();
    expect(judge(base).status).toBe(0);
  });

  it("flags a protected file whose name git would quote, without failing", () => {
    const base = git("rev-parse", "HEAD");
    write(".claude/é.json", "{}\n");
    commit();
    const result = judge(base);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Protected files changed (a flag, not a block): 1");
    expect(result.stdout).toContain(".claude/é.json");
  });

  it("flags a protected file in other capitals", () => {
    const base = git("rev-parse", "HEAD");
    write(".MCP.json", "{}\n");
    commit();
    expect(judge(base).stdout).toContain("Protected files changed (a flag, not a block): 1");
  });

  it("flags a protected file with a name git would read as a pattern", () => {
    const base = git("rev-parse", "HEAD");
    write(".claude/:(glob)x*.json", "{}\n");
    commit();
    expect(judge(base).stdout).toContain("Protected files changed (a flag, not a block): 1");
  });

  it("flags a change to what decides how many tests run", () => {
    const base = git("rev-parse", "HEAD");
    write("scripts/test-scope-core.mjs", 'export const testScope = () => ({ mode: "docs" });\n');
    commit();
    const result = judge(base);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("scripts/test-scope-core.mjs");
  });

  describe("the suite's bypass switch", () => {
    const file = "src/config/deny-by-default.ts";
    const set = (value: boolean) => `export const SUITE_RUNS_WITHOUT_BYPASS = ${value};\n`;

    it("may be turned on, with a flag and no approval", () => {
      write(file, set(false));
      const base = commit();
      write(file, set(true));
      commit();
      const result = judge(base);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Sensitive files changed (a flag, not a block): 1");
    });

    it("is flagged when turned back off", () => {
      write(file, set(true));
      const base = commit();
      write(file, set(false));
      commit();
      const result = judge(base);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("went back to running with a bypass");
    });
  });

  it("flags a watched file without failing", () => {
    const base = git("rev-parse", "HEAD");
    write("src/lib/advice-mode.ts", "export const on = true;\n");
    commit();
    const result = judge(base);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Sensitive files changed (a flag, not a block): 1");
  });

  it("flags a baseline score set to null", () => {
    const base = git("rev-parse", "HEAD");
    write("src/accuracy/baseline.json", JSON.stringify({ tuning: { bills: { recall: null } } }));
    commit();
    const result = judge(base);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("went from 1 to null");
  });

  it("flags a baseline that no longer reads as JSON", () => {
    const base = git("rev-parse", "HEAD");
    write("src/accuracy/baseline.json", "not json");
    commit();
    expect(judge(base).stdout).toContain("Accuracy baselines dropped (a flag, not a block): 1");
  });

  it("flags package.json's scripts changing, not its other parts", () => {
    const base = git("rev-parse", "HEAD");
    write("package.json", JSON.stringify({ version: "2", scripts: { test: "vitest run" } }));
    commit();
    expect(judge(base).status).toBe(0);
    write("package.json", JSON.stringify({ version: "2", scripts: { test: "true" } }));
    commit();
    const result = judge(base);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("package.json: its scripts changed");
  });

  describe("weakened tests", () => {
    it("flags a test file renamed so it no longer runs", () => {
      const base = git("rev-parse", "HEAD");
      renameSync(join(repo, "src/a.test.ts"), join(repo, "src/a.test.ts.off"));
      commit();
      const result = judge(base);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Tests weakened (a flag, not a block): 1");
      expect(result.stdout).toContain("no longer runs");
    });

    it("sees an expect line deleted in a file that was also renamed", () => {
      const base = git("rev-parse", "HEAD");
      const lines = 'it("adds", () => {\n  expect(1 + 1).toBe(2);\n});\n'.repeat(19);
      renameSync(join(repo, "src/a.test.ts"), join(repo, "src/b.test.ts"));
      write("src/b.test.ts", `${lines}it("adds", () => {\n});\n`);
      commit();
      const result = judge(base);
      expect(result.stdout).toContain("Tests weakened (a flag, not a block): 1");
      expect(result.stdout).toContain("expect deleted, src/b.test.ts");
    });

    it("can't be used to start a workflow command in the log", () => {
      const lines = 'it("adds", () => {\n  expect(1 + 1).toBe(2);\n});\n'.repeat(20);
      const tricky = "  expect(9).toBe(9); \r::error::forged\r\n";
      write("src/c.test.ts", `${tricky}${lines}`);
      const second = commit();
      write("src/c.test.ts", lines);
      commit();
      const result = judge(second, {}, { GITHUB_ACTIONS: "true" });
      expect(result.stdout).toContain("expect deleted");
      for (const line of result.stdout.split(/[\r\n]/)) {
        expect(line.trimStart().startsWith("::error")).toBe(false);
      }
    });

    it("can't be used to start one with a line break in a file name", () => {
      const base = git("rev-parse", "HEAD");
      write(".claude/x\n::error::forged", "{}\n");
      commit();
      const result = judge(base, {}, { GITHUB_ACTIONS: "true" });
      expect(result.status).toBe(0);
      const forged = result.stdout
        .split(/[\r\n]/)
        .filter((line) => line.trimStart().startsWith("::error::forged"));
      expect(forged).toEqual([]);
    });
  });
});
