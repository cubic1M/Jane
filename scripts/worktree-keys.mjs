// Keys reach a worktree (connectors batch 2, section C4; docs/setup/worktree-keys.md). The keys live in
// the main checkout's local .env, which a worktree under .claude/worktrees/ doesn't see. This links the
// worktree's .env to it, so its dev server loads them beneath its own .env.local. It never copies, reads
// or prints a value: a symlink, created only where git ignores it, and only to the main checkout's .env.
//   node scripts/worktree-keys.mjs           link (does nothing if already linked)
//   node scripts/worktree-keys.mjs --unlink  remove the link
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// The main checkout (where .git lives) and this worktree, or null when this isn't a worktree.
export function checkouts(cwd) {
  const top = git(cwd, "rev-parse", "--show-toplevel");
  const common = resolve(cwd, git(cwd, "rev-parse", "--git-common-dir"));
  const main = dirname(common);
  return main === top ? null : { main, worktree: top };
}

// What linking does, without touching anything: one of linked, already, own-file, no-main-env,
// not-ignored, not-a-worktree.
export function linkKeys({ main, worktree, ignored, dryRun = false }) {
  if (!main || !worktree) return "not-a-worktree";
  const target = join(main, ".env");
  const link = join(worktree, ".env");
  if (!existsSync(target)) return "no-main-env";
  if (!ignored(link)) return "not-ignored";
  try {
    const stat = lstatSync(link);
    if (!stat.isSymbolicLink()) return "own-file";
    if (readlinkSync(link) === target) return "already";
    return "own-file";
  } catch {
    // No .env here yet.
  }
  if (!dryRun) symlinkSync(target, link);
  return "linked";
}

export function unlinkKeys({ worktree, main }) {
  const link = join(worktree, ".env");
  try {
    if (lstatSync(link).isSymbolicLink() && readlinkSync(link) === join(main, ".env")) {
      unlinkSync(link);
      return "unlinked";
    }
  } catch {
    // Nothing there.
  }
  return "not-linked";
}

const WORDS = {
  linked: "Linked this worktree's .env to the main checkout's. Restart the dev server to load it.",
  already: "Already linked to the main checkout's .env.",
  "own-file": "This worktree has its own .env; left as it is.",
  "no-main-env": "The main checkout has no .env yet: add the keys there first.",
  "not-ignored": "Refused: git doesn't ignore .env here, so a link could be committed.",
  "not-a-worktree": "This is the main checkout: its .env is already the one the dev server loads.",
  unlinked: "Removed the link.",
  "not-linked": "No link to remove.",
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const found = checkouts(process.cwd());
  const ignored = (path) => {
    try {
      execFileSync("git", ["check-ignore", "-q", path], { cwd: found?.worktree ?? process.cwd() });
      return true;
    } catch {
      return false;
    }
  };
  const outcome = !found
    ? "not-a-worktree"
    : process.argv.includes("--unlink")
      ? unlinkKeys(found)
      : linkKeys({ ...found, ignored });
  console.log(WORDS[outcome]);
  process.exit(outcome === "not-ignored" || outcome === "no-main-env" ? 1 : 0);
}
