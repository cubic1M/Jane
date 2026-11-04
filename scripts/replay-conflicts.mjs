// How often a recent change would have conflicted had it been written some commits behind main, and
// in which files: the measure behind the conflict habits in CLAUDE.md. A proxy, and it overstates
// long windows. Reads git only.
//   node scripts/replay-conflicts.mjs [commits=200] [behind=8]
import { spawnSync } from "node:child_process";

const count = Number(process.argv[2] ?? 200);
const behind = Number(process.argv[3] ?? 8);
const git = (...args) => spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const commits = git("rev-list", "--first-parent", "-n", String(count + behind + 1), "origin/main")
  .stdout.split("\n")
  .filter(Boolean);
const files = new Map();
let conflicted = 0;
for (let i = 0; i < count && i + 1 + behind < commits.length; i += 1) {
  const merged = git(
    "merge-tree",
    "--write-tree",
    "--merge-base",
    commits[i + 1],
    commits[i + 1 + behind],
    commits[i],
  );
  if (merged.status !== 1) continue;
  conflicted += 1;
  const names = merged.stdout.split("\n").flatMap((line) => line.split("\t").slice(1, 2));
  for (const name of new Set(names)) files.set(name, (files.get(name) ?? 0) + 1);
}
console.log(
  `${count} commits, ${behind} behind: ${conflicted} conflict (${((100 * conflicted) / count).toFixed(1)}%)`,
);
for (const [name, times] of [...files].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`${times} ${name}`);
}
