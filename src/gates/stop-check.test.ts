import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  changedFiles,
  codeFiles,
  fingerprint,
  isOwnBranch,
  relatedTests,
  runCheck,
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
  it("carries only what the tools need: no tokens, and no real database", () => {
    const env = safeEnv({
      PATH: "/bin",
      HOME: "/home/x",
      GH_TOKEN: "t",
      ANTHROPIC_API_KEY: "k",
      TOKEN_ENCRYPTION_KEY: "k",
      HTTPS_PROXY: "http://127.0.0.1:7897",
      DATABASE_URL: "postgresql://u:p@db.example.test/live",
      DIRECT_URL: "postgresql://u:p@db.example.test/live",
      TEST_DATABASE_URL: "postgresql://u:p@db.example.test/live",
    });
    expect(env).toEqual({ PATH: "/bin", HOME: "/home/x" });
  });

  it("keeps a test database on this machine", () => {
    const url = "postgresql://postgres:postgres@localhost:55432/test";
    expect(safeEnv({ TEST_DATABASE_URL: url }).TEST_DATABASE_URL).toBe(url);
  });

  it.each([
    "postgresql://evil-localhost/db",
    "postgresql://localhost.example.test/db",
    "postgresql://u:p@evil.example.test/localhost/",
  ])("doesn't take %s for one", (url) => {
    expect(safeEnv({ TEST_DATABASE_URL: url }).TEST_DATABASE_URL).toBeUndefined();
  });
});

// A stand-in for npx that says it ran and what it was given, in a repo set up each way a checkout can
// be. The real hook, the real git.
describe("whose code it runs", () => {
  let repo = "";
  let bin = "";
  let ranFile = "";
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  const hook = () =>
    spawnSync(process.execPath, [".claude/hooks/stop-check.mjs"], {
      input: JSON.stringify({ cwd: repo }),
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: process.env.HOME,
        GH_TOKEN: "not-for-a-stranger",
      },
    });
  const ran = () => (existsSync(ranFile) ? readFileSync(ranFile, "utf8") : "");

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "stop-whose-"));
    bin = mkdtempSync(join(tmpdir(), "stop-bin-"));
    ranFile = join(bin, "ran.txt");
    writeFileSync(
      join(bin, "npx"),
      `#!/bin/sh\necho "npx $1 GH_TOKEN=[$GH_TOKEN]" >> "${ranFile}"\nexit 0\n`,
    );
    chmodSync(join(bin, "npx"), 0o755);
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.test");
    git("config", "user.name", "t");
    mkdirSync(join(repo, "node_modules"));
    writeFileSync(join(repo, ".gitignore"), "node_modules\n");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    git("add", ".");
    git("commit", "-qm", "first");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-qb", "lane");
    writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");
    git("add", ".");
    git("commit", "-qm", "their change");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  });

  it("runs the checks on a session's own new branch, without its tokens", () => {
    expect(isOwnBranch(repo)).toBe(true);
    expect(hook().status).toBe(0);
    expect(ran()).toContain("npx eslint GH_TOKEN=[]");
  });

  it("runs them on a branch that follows this repo", () => {
    git("config", "branch.lane.remote", "origin");
    git("config", "branch.lane.merge", "refs/heads/lane");
    expect(isOwnBranch(repo)).toBe(true);
    hook();
    expect(ran()).toContain("npx eslint");
  });

  it("runs nothing on a detached HEAD", () => {
    git("checkout", "-q", "--detach");
    const result = hook();
    expect(result.stdout).toContain("skipped");
    expect(ran()).toBe("");
  });

  it("runs nothing on a branch that follows someone's fork, as gh pr checkout leaves it", () => {
    git("config", "branch.lane.remote", "https://github.com/stranger/Jane.git");
    git("config", "branch.lane.merge", "refs/heads/lane");
    expect(hook().stdout).toContain("skipped");
    expect(ran()).toBe("");
  });

  it("runs nothing on a branch that follows a pull ref", () => {
    git("config", "branch.lane.remote", "origin");
    git("config", "branch.lane.merge", "refs/pull/12/head");
    expect(hook().stdout).toContain("skipped");
    expect(ran()).toBe("");
  });
});

describe("a check that runs out of time", () => {
  it("ends on time with everything it started, even if a child holds the output open", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stop-kill-"));
    const script = join(dir, "slow.sh");
    const pidFile = join(dir, "pid");
    writeFileSync(script, `#!/bin/sh\nsleep 60 &\necho $! > "${pidFile}"\nwait\n`);
    chmodSync(script, 0o755);
    const started = Date.now();
    const result = await runCheck(dir, [], 1, { PATH: process.env.PATH }, script);
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
    const pid = Number(readFileSync(pidFile, "utf8"));
    // Signal 0 only asks whether it's there. Give the kill a moment to land.
    await new Promise((done) => setTimeout(done, 200));
    expect(() => process.kill(pid, 0)).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports a check's exit code when it finishes in time", async () => {
    const result = await runCheck("/", ["-c", "echo hi; exit 3"], 5, {}, "/bin/sh");
    expect(result).toEqual({ code: 3, output: "hi\n", timedOut: false });
  });
});
