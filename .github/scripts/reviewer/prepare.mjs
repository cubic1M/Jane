#!/usr/bin/env node
// Works out what's being reviewed: the PR, its tier and its diff as text. Holds a read-only token and
// runs none of the PR's code. Writes input.json and diff.txt to --out, and step outputs.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseNameStatus } from "../gates/core.mjs";
import { tierOfChanges } from "../gates/tiers.mjs";
import { CHECK_NAME, MAX_DIFF_BYTES, pickPr } from "./core.mjs";

const { values: args } = parseArgs({
  options: { out: { type: "string" }, "skip-merge-wait": { type: "boolean", default: false } },
});
const { REPO, SHA, HEAD_REPO, HEAD_BRANCH, RUN_ATTEMPT = "1" } = process.env;

const git = (...a) =>
  execFileSync("git", ["--literal-pathspecs", ...a], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: "pipe",
  });
const api = (path) =>
  JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));

function output(values) {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  console.log(lines.join(" "));
}

function fetchMerge(number) {
  // GitHub builds the merge ref a moment after a push.
  for (let attempt = 1; ; attempt += 1) {
    try {
      git("fetch", "-q", "--no-tags", "--depth=2", "origin", `refs/pull/${number}/merge`);
      if (git("rev-parse", "FETCH_HEAD^2").trim() === SHA)
        return git("rev-parse", "FETCH_HEAD").trim();
    } catch {
      // Tried again below.
    }
    if (attempt === 6) throw new Error(`No merge commit for ${SHA}: does the PR have conflicts?`);
    execFileSync("sleep", [args["skip-merge-wait"] ? "0" : "10"]);
  }
}

function main() {
  mkdirSync(args.out, { recursive: true });
  const write = (input) => writeFileSync(join(args.out, "input.json"), JSON.stringify(input));
  if (HEAD_REPO !== REPO) {
    // Its number is only for reading a founder's approval. Nothing of a fork's is read or run.
    const owner = HEAD_REPO.split("/")[0];
    const head = encodeURIComponent(`${owner}:${HEAD_BRANCH}`);
    const pr = api(`repos/${REPO}/pulls?state=open&head=${head}`).find((p) => p.head?.sha === SHA);
    write({ sha: SHA, fork: true, tier: "C", number: pr?.number, author: pr?.user?.login });
    output({ post: true, run: false, fork: true, tier: "C" });
    return;
  }
  const pr = pickPr(api(`repos/${REPO}/commits/${SHA}/pulls`), { repo: REPO, sha: SHA });
  if (!pr || pr.draft) {
    console.log(pr ? "A draft isn't reviewed yet." : "No open PR has this commit as its head.");
    output({ post: false, run: false });
    return;
  }
  // A re-run is a request to judge again. Otherwise one review a commit, however often CI re-runs.
  const name = encodeURIComponent(CHECK_NAME);
  const earlier =
    api(`repos/${REPO}/commits/${SHA}/check-runs?check_name=${name}`).check_runs ?? [];
  if (RUN_ATTEMPT === "1" && earlier.some((run) => run.status === "completed")) {
    console.log("This commit already has a verdict.");
    output({ post: false, run: false });
    return;
  }
  const merge = fetchMerge(pr.number);
  const changes = parseNameStatus(
    git("diff", "-z", "--name-status", "--no-renames", `${merge}^1`, merge),
  );
  const sqlOf = (file) => {
    try {
      return git("show", `${merge}:${file}`);
    } catch {
      return null;
    }
  };
  const { tier, files } = tierOfChanges(changes, sqlOf);
  const diff = execFileSync(
    "git",
    [
      "diff",
      "--no-color",
      "--no-ext-diff",
      `${merge}^1`,
      merge,
      "--",
      ".",
      ":(exclude,top)package-lock.json",
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: "pipe" },
  );
  const tooBig = Buffer.byteLength(diff) > MAX_DIFF_BYTES;
  writeFileSync(join(args.out, "diff.txt"), tooBig ? "" : diff);
  write({
    sha: SHA,
    fork: false,
    number: pr.number,
    branch: pr.head.ref,
    author: pr.user?.login,
    labels: (pr.labels ?? []).map((label) => label.name),
    tier,
    tierFiles: files,
    tooBig,
  });
  output({
    post: true,
    run: !tooBig,
    fork: false,
    tier,
    number: pr.number,
  });
  writeFileSync(join(args.out, "branch.txt"), pr.head.ref);
}

main();
