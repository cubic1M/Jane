import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// .claude/hooks/deny.mjs refuses a push of a branch that changes what a page shows until
// npm run e2e:touched has passed on its last commit (scripts/e2e-touched.mjs keeps the pass in the
// worktree's git dir). A PR runs only the @critical specs, so a page change that broke another spec
// reddened main instead: #2161 and #2166, 11-20.

const HOOK = resolve(".claude/hooks/deny.mjs");

function repo(changed: string) {
  const dir = mkdtempSync(join(tmpdir(), "deny-pages-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
      {
        encoding: "utf8",
      },
    ).trim();
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, "src/lib/area-pages"), { recursive: true });
  writeFileSync(join(dir, "README.md"), "x\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("switch", "-qc", "claude/lane");
  mkdirSync(join(dir, changed, ".."), { recursive: true });
  writeFileSync(join(dir, changed), "// changed\n");
  git("add", "-A");
  git("commit", "-qm", "change");
  return { dir, git };
}

const push = (cwd: string) =>
  spawnSync("node", [HOOK], {
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "git push -u origin claude/lane" },
      cwd,
    }),
    encoding: "utf8",
  });

describe("pushing a page change", () => {
  it("is refused until npm run e2e:touched passed on the last commit", () => {
    const { dir, git } = repo("src/lib/area-pages/insurance.ts");
    const before = push(dir);
    expect(before.status).toBe(2);
    expect(before.stderr).toMatch(/src\/lib\/area-pages\/insurance\.ts.*npm run e2e:touched/);
    writeFileSync(
      resolve(dir, git("rev-parse", "--git-path", "e2e-touched-pass")),
      `${git("rev-parse", "HEAD")}\n`,
    );
    expect(push(dir).status).toBe(0);
  });

  it("goes for a change no page shows", () => {
    expect(push(repo("src/lib/jane-agent/intents.ts").dir).status).toBe(0);
  });
});
