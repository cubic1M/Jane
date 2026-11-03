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
      { cwd: repo, encoding: "utf8", env: { PATH: process.env.PATH, HOME: "/tmp", ...env } },
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

  it("fails a protected file whose name git would quote", () => {
    const base = git("rev-parse", "HEAD");
    write(".claude/é.json", "{}\n");
    commit();
    const result = judge(base);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(".claude/é.json");
  });

  it("fails a protected file in other capitals", () => {
    const base = git("rev-parse", "HEAD");
    write(".MCP.json", "{}\n");
    commit();
    expect(judge(base).status).toBe(1);
  });

  it("fails a protected file with a name git would read as a pattern", () => {
    const base = git("rev-parse", "HEAD");
    write(".claude/:(glob)x*.json", "{}\n");
    commit();
    expect(judge(base).status).toBe(1);
  });

  it("flags a watched file without failing", () => {
    const base = git("rev-parse", "HEAD");
    write("src/lib/advice-mode.ts", "export const on = true;\n");
    commit();
    const result = judge(base);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Sensitive files changed (a flag, not a block): 1");
  });

  it("fails a baseline score set to null", () => {
    const base = git("rev-parse", "HEAD");
    write("src/accuracy/baseline.json", JSON.stringify({ tuning: { bills: { recall: null } } }));
    commit();
    const result = judge(base);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("went from 1 to null");
  });

  it("fails a baseline that no longer reads as JSON", () => {
    const base = git("rev-parse", "HEAD");
    write("src/accuracy/baseline.json", "not json");
    commit();
    expect(judge(base).status).toBe(1);
  });

  it("fails package.json's scripts changing, not its other parts", () => {
    const base = git("rev-parse", "HEAD");
    write("package.json", JSON.stringify({ version: "2", scripts: { test: "vitest run" } }));
    commit();
    expect(judge(base).status).toBe(0);
    write("package.json", JSON.stringify({ version: "2", scripts: { test: "true" } }));
    commit();
    const result = judge(base);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("package.json: its scripts changed");
  });

  describe("a founder's approval", () => {
    const founder = { FOUNDER_LOGINS: "founder" };
    const approvalOf = (commit: string) => ({
      reviews: [{ login: "founder", state: "APPROVED", commit }],
    });

    it("lets the exact commit through", () => {
      const base = git("rev-parse", "HEAD");
      write(".mcp.json", "{}\n");
      const head = commit();
      const result = judge(base, approvalOf(head), founder);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("approved by founder");
    });

    it("doesn't reach a later commit back-dated to before the approval", () => {
      const base = git("rev-parse", "HEAD");
      write(".mcp.json", "{}\n");
      const approved = commit();
      write(".mcp.json", '{ "mcpServers": { "added": {} } }\n');
      const old = "2020-01-01T00:00:00Z";
      commit({ GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old });
      expect(git("show", "-s", "--format=%cI", "HEAD")).toContain("2020");
      const result = judge(base, approvalOf(approved), founder);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("older commit");
    });

    it("judges the PR's own commit when it runs on GitHub's merge commit", () => {
      const base = git("rev-parse", "HEAD");
      git("checkout", "-qb", "lane");
      write(".mcp.json", "{}\n");
      const prHead = commit();
      git("checkout", "-q", "main");
      write("README.md", "main moved\n");
      const newBase = commit();
      git("merge", "-q", "--no-ff", "--no-edit", "lane");
      expect(git("rev-parse", "HEAD^2")).toBe(prHead);
      expect(judge(newBase, approvalOf(prHead), founder).status).toBe(0);
      expect(judge(newBase, approvalOf(base), founder).status).toBe(1);
    });
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
      expect(result.status).toBe(1);
      const forged = result.stdout
        .split(/[\r\n]/)
        .filter((line) => line.trimStart().startsWith("::error::forged"));
      expect(forged).toEqual([]);
    });
  });
});
