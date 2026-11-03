// Run in CI, or before pushing: npm run check:migrations. Checks the migrations this change adds or
// touches against what's already on main, and exits 1 on anything docs/migrations.md forbids.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { HEAD_FILE, migrationChanges, migrationProblems } from "./migration-gate-core.mjs";

const SQUAWK = "squawk-cli@2.70.0";
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();

function baseCommit() {
  const event = process.env.GITHUB_EVENT_NAME;
  // CI checks out a test merge for a PR or merge group, and main is one commit per merge.
  const onMain = process.env.GITHUB_REF === "refs/heads/main";
  return event === "pull_request" || event === "merge_group" || onMain
    ? git("rev-parse", "HEAD^1")
    : git("merge-base", "origin/main", "HEAD");
}

const base = baseCommit();
const namesAt = (ref) =>
  git("ls-tree", "-d", "--name-only", `${ref}:prisma/migrations`).split("\n").filter(Boolean);
const headNames = readdirSync("prisma/migrations").filter((n) =>
  statSync(`prisma/migrations/${n}`).isDirectory(),
);
const { added, altered } = migrationChanges(
  git("diff", "--name-status", "--no-renames", base, "HEAD", "--", "prisma/migrations"),
);

function squawk(names) {
  if (names.length === 0) return [];
  const files = names.map((n) => `prisma/migrations/${n}/migration.sql`);
  const run = spawnSync(
    "npx",
    ["--yes", SQUAWK, "--reporter", "json", "--pg-version", "16", ...files],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  try {
    return JSON.parse(run.stdout);
  } catch {
    // Not reading the SQL isn't a pass.
    console.error(run.stderr || run.stdout);
    console.error(`${SQUAWK} didn't run, so the new migrations weren't checked.`);
    process.exit(1);
  }
}

const problems = migrationProblems({
  baseNames: namesAt(base),
  headNames,
  added,
  altered,
  headFile: existsSync(HEAD_FILE) ? readFileSync(HEAD_FILE, "utf8") : "",
  sqlOf: (name) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8"),
  findings: squawk(added),
});
for (const problem of problems) console.log(`::error::${problem}`);
if (problems.length > 0) process.exit(1);
console.log(`Migrations OK: ${added.length} new against ${base.slice(0, 8)}, none unsafe.`);
