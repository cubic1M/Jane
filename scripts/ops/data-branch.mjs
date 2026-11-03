// The ops-numbers branch holds the numbers page and the records behind it (flake-list.mjs keeps its
// data the same way). Only counts, times and short ids go here: the repo is public, and the secret
// scan reads every branch. Each writer adds a commit and retries if another got there first, so the
// actor's log can't be lost to a force push.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const DATA_BRANCH = "ops-numbers";
const REPO = process.env.GITHUB_REPOSITORY ?? "cubic1M/Jane";
const TRIES = 5;

const remoteUrl = () =>
  process.env.GH_TOKEN
    ? `https://x-access-token:${process.env.GH_TOKEN}@github.com/${REPO}.git`
    : `https://github.com/${REPO}.git`;

function checkout() {
  const dir = mkdtempSync(join(tmpdir(), "ops-numbers-"));
  const git = (...args) =>
    execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q", "-b", DATA_BRANCH);
  git("remote", "add", "origin", remoteUrl());
  try {
    git("fetch", "-q", "origin", DATA_BRANCH);
    git("reset", "-q", "--hard", "FETCH_HEAD");
  } catch {
    // No branch yet: the first writer starts it.
  }
  return { dir, git };
}

export function readData(file) {
  const { dir } = checkout();
  const path = join(dir, file);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

// change(read) returns { file: newText }. It runs again on each try, on the newest data.
export function writeData(message, change) {
  for (let attempt = 1; attempt <= TRIES; attempt += 1) {
    const { dir, git } = checkout();
    const read = (file) =>
      existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8") : "";
    for (const [file, text] of Object.entries(change(read))) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), text);
    }
    git("add", "-A");
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
    try {
      git("push", "-q", "origin", `HEAD:${DATA_BRANCH}`);
      return;
    } catch (error) {
      if (attempt === TRIES) throw error;
    }
  }
}
