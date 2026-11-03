import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  changedFiles,
  codeFiles,
  fingerprint,
  relatedTests,
  safeEnv,
} from "../../.claude/hooks/stop-check.mjs";

describe("what the stop check looks at", () => {
  let repo = "";
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "stop-check-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.test");
    git("config", "user.name", "t");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    git("add", ".");
    git("commit", "-qm", "first");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-qb", "lane");
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("sees nothing on a clean branch", () => {
    expect(changedFiles(repo)).toEqual([]);
  });

  it("sees files committed on the branch, edited, and new", () => {
    writeFileSync(join(repo, "committed.ts"), "1\n");
    git("add", ".");
    git("commit", "-qm", "two");
    writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");
    writeFileSync(join(repo, "new.ts"), "1\n");
    expect(changedFiles(repo).sort()).toEqual(["a.ts", "committed.ts", "new.ts"]);
  });

  it("remembers a check by the commit and the files' bytes", () => {
    writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");
    const first = fingerprint(repo, ["a.ts"]);
    expect(fingerprint(repo, ["a.ts"])).toBe(first);
    writeFileSync(join(repo, "a.ts"), "export const a = 3;\n");
    expect(fingerprint(repo, ["a.ts"])).not.toBe(first);
  });

  it("does nothing on a stop with no change, or on the stop after a refusal", () => {
    const hook = (input: object) =>
      spawnSync("node", [".claude/hooks/stop-check.mjs"], {
        input: JSON.stringify(input),
        encoding: "utf8",
      });
    expect(hook({ cwd: repo }).status).toBe(0);
    writeFileSync(join(repo, "a.ts"), "broken(\n");
    expect(hook({ cwd: repo, stop_hook_active: true }).status).toBe(0);
  });
});

describe("which tests it runs", () => {
  let repo = "";
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), text);
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "stop-tests-"));
    execFileSync("git", ["-C", repo, "init", "-q"]);
    write("src/lib/rule.ts", "export const a = 1;\n");
    write("src/lib/rule.test.ts", 'import { a } from "./rule";\n');
    write("src/other/uses.test.ts", 'import { a } from "@/lib/rule";\n');
    write("src/other/db.integration.test.ts", 'import { a } from "@/lib/rule";\n');
    write("src/other/unrelated.test.ts", 'import { b } from "./unrule-ish";\n');
    write("src/lib/index.ts", "export {};\n");
    write("src/app/thing/index.ts", "export {};\n");
    write("src/app/thing/thing.test.ts", 'import x from "@/app/thing";\n');
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("is the tests that import a changed file, nearest first, not the rest", () => {
    expect(relatedTests(repo, ["src/lib/rule.ts"])).toEqual([
      "src/lib/rule.test.ts",
      "src/other/uses.test.ts",
    ]);
  });

  it("includes a changed test, and an integration test only with a database", () => {
    expect(relatedTests(repo, ["src/other/unrelated.test.ts"])).toEqual([
      "src/other/unrelated.test.ts",
    ]);
    expect(relatedTests(repo, ["src/lib/rule.ts"], { withDatabase: true })).toContain(
      "src/other/db.integration.test.ts",
    );
  });

  it("finds a folder's index by the folder's name", () => {
    expect(relatedTests(repo, ["src/app/thing/index.ts"])).toEqual(["src/app/thing/thing.test.ts"]);
  });
});

describe("what it checks", () => {
  it("is code only, not the generated client", () => {
    expect(
      codeFiles(["a.ts", "b.tsx", "c.mjs", "d.md", "e.json", "src/generated/prisma/x.ts"]),
    ).toEqual(["a.ts", "b.tsx", "c.mjs"]);
  });
});

describe("the environment it runs in", () => {
  it("can't reach a real database", () => {
    const env = safeEnv({
      PATH: "/bin",
      DATABASE_URL: "postgresql://u:p@db.example.test/live",
      DIRECT_URL: "postgresql://u:p@db.example.test/live",
      TEST_DATABASE_URL: "postgresql://u:p@db.example.test/live",
    });
    expect(env).toEqual({ PATH: "/bin" });
  });

  it("keeps a test database on this machine", () => {
    const url = "postgresql://postgres:postgres@localhost:55432/test";
    expect(safeEnv({ TEST_DATABASE_URL: url }).TEST_DATABASE_URL).toBe(url);
  });
});
