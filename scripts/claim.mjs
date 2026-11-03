// Task claims that expire (docs/agent-loop.md), kept as one file on the claude/task-claims branch.
//   node scripts/claim.mjs take pr-123 lane:chat [hours]
//   node scripts/claim.mjs release pr-123
//   node scripts/claim.mjs list
// A plain push is the lock: if someone else got in first, the push is refused, and this reads again.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeClaims, releaseClaim, takeClaim } from "./loop-core.mjs";

const BRANCH = "claude/task-claims";
const TRIES = 5;
const [command, task, lane, hours] = process.argv.slice(2);

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe" }).trim();
const origin = run("git", ["remote", "get-url", "origin"]);
const dir = mkdtempSync(join(tmpdir(), "claims-"));
const git = (...args) => run("git", ["-C", dir, ...args]);
git("init", "-q", "-b", "claims");
git("remote", "add", "origin", origin);
const file = join(dir, "claims.json");

function read() {
  try {
    git("fetch", "-q", "--depth=1", "origin", BRANCH);
    git("reset", "-q", "--hard", "FETCH_HEAD");
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function write(claims, message) {
  writeFileSync(file, `${JSON.stringify(claims, null, 1)}\n`);
  git("add", "claims.json");
  git(
    "-c",
    "user.name=github-actions[bot]",
    "-c",
    "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    message,
  );
  git("push", "-q", "origin", `HEAD:refs/heads/${BRANCH}`);
}

function main() {
  if (command === "list") {
    for (const claim of activeClaims(read(), new Date().toISOString())) {
      console.log(`${claim.task} ${claim.lane} until ${claim.expires}`);
    }
    return 0;
  }
  if (!task || (command !== "take" && command !== "release")) {
    console.error("Use: claim.mjs take <task> <lane:name> [hours] | release <task> | list");
    return 2;
  }
  for (let attempt = 1; attempt <= TRIES; attempt += 1) {
    const now = new Date().toISOString();
    const claims = read();
    try {
      if (command === "release") {
        write(releaseClaim(claims, task, now), `Release ${task}`);
        console.log(`Released ${task}.`);
        return 0;
      }
      const taken = takeClaim(claims, {
        task,
        lane,
        hours: hours ? Number(hours) : undefined,
        now,
      });
      if (!taken.ok) {
        console.error(`${task} is held by ${taken.holder.lane} until ${taken.holder.expires}.`);
        return 1;
      }
      write(taken.claims, `Claim ${task}`);
      console.log(`Claimed ${task} for ${lane}.`);
      return 0;
    } catch (error) {
      if (attempt === TRIES) throw error;
    }
  }
  return 1;
}

process.exit(main());
