import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkouts, linkKeys, unlinkKeys } from "../../scripts/worktree-keys.mjs";

// Section C4: a worktree's dev server gets the main checkout's keys by a link, never a copy, and only
// where git ignores it. Against a throwaway repo and worktree with a fake .env.

const root = realpathSync(mkdtempSync(join(tmpdir(), "worktree-keys-")));
const main = join(root, "main");
const worktree = join(root, "main", ".claude", "worktrees", "w1");
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });
const FAKE = "FAKE_KEY=not-a-real-value\n";

execFileSync("mkdir", ["-p", main]);
git(main, "init", "-q", "-b", "main");
writeFileSync(join(main, ".gitignore"), ".env*\n.claude/\n");
git(main, "add", ".gitignore");
git(main, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "init");
git(main, "worktree", "add", "-q", worktree);
const ignored = (path: string) => {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd: worktree });
    return true;
  } catch {
    return false;
  }
};

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("keys reach a worktree", () => {
  it("finds the main checkout from a worktree, and nothing from the main checkout", () => {
    expect(checkouts(worktree)).toEqual({ main, worktree });
    expect(checkouts(main)).toBeNull();
  });

  it("waits for the main checkout's .env", () => {
    expect(linkKeys({ main, worktree, ignored })).toBe("no-main-env");
  });

  it("links the worktree's .env to the main checkout's, once, without copying it", () => {
    writeFileSync(join(main, ".env"), FAKE);
    expect(linkKeys({ main, worktree, ignored })).toBe("linked");
    expect(lstatSync(join(worktree, ".env")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(worktree, ".env"))).toBe(join(main, ".env"));
    expect(linkKeys({ main, worktree, ignored })).toBe("already");
    // Nothing to commit: git ignores the link.
    expect(git(worktree, "status", "--porcelain")).toBe("");
  });

  it("refuses where git wouldn't ignore it, and leaves a worktree's own .env alone", () => {
    expect(unlinkKeys({ main, worktree })).toBe("unlinked");
    expect(linkKeys({ main, worktree, ignored: () => false })).toBe("not-ignored");
    writeFileSync(join(worktree, ".env"), "OWN=1\n");
    expect(linkKeys({ main, worktree, ignored })).toBe("own-file");
    expect(unlinkKeys({ main, worktree })).toBe("not-linked");
  });

  it("prints no value", () => {
    rmSync(join(worktree, ".env"));
    const out = execFileSync("node", [join(process.cwd(), "scripts/worktree-keys.mjs")], {
      cwd: worktree,
      encoding: "utf8",
    });
    expect(out).toContain("Linked this worktree's .env");
    expect(out).not.toContain("not-a-real-value");
  });
});
