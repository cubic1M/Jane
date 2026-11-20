// npm run accuracy:drift: both accuracy scoreboards on this commit's code, against this commit's
// baselines. Prints every score that fell or rose and exits 1 on a fall; CI's gate only compares
// the baseline files, so code that moves a score without rewriting them passed every check (the
// CSV drift after #1852, found 11-20). The scoreboards run in a throwaway worktree of HEAD, so
// nothing here is rewritten; what isn't committed isn't scored. The result is kept in the git dir
// (DRIFT_FILE) for the push warning in .claude/hooks/deny.mjs.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BASELINE_FILES, DRIFT_FILE, driftOf, driftReport } from "./accuracy-drift-core.mjs";

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 << 20 }).trim();
const head = git("rev-parse", "HEAD");
const root = git("rev-parse", "--show-toplevel");
const dir = mkdtempSync(join(tmpdir(), "accuracy-drift-"));
const run = (cmd, args, env = {}) =>
  execFileSync(cmd, args, { cwd: dir, stdio: "inherit", env: { ...process.env, ...env } });

let exitCode = 2;
try {
  git("worktree", "add", "--detach", "--quiet", dir, head);
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
  run("npx", ["prisma", "generate"]);
  run(
    "npx",
    [
      "vitest",
      "run",
      "src/accuracy/scoreboard.cli.test.ts",
      "src/accuracy/csv/scoreboard.cli.test.ts",
    ],
    { ACCURACY: "1", ACCURACY_WRITE: "1" },
  );
  const committed = Object.fromEntries(
    BASELINE_FILES.map((f) => [f, JSON.parse(git("show", `${head}:${f}`))]),
  );
  const scored = Object.fromEntries(
    BASELINE_FILES.map((f) => [f, JSON.parse(readFileSync(join(dir, f), "utf8"))]),
  );
  const drift = driftOf(committed, scored);
  const { text, exitCode: code } = driftReport(drift);
  console.log(`\n${text}`);
  writeFileSync(
    resolve(git("rev-parse", "--git-path", DRIFT_FILE)),
    `${JSON.stringify({ head, falls: drift.falls })}\n`,
  );
  exitCode = code;
} finally {
  try {
    git("worktree", "remove", "--force", dir);
  } catch {
    rmSync(dir, { recursive: true, force: true });
  }
}
process.exit(exitCode);
