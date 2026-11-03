// Run by CI's "Test scope" job: decides how much of the suite this run needs, for the jobs after it.
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  changedSpecs,
  docsNamedIn,
  shardsFor,
  testScope,
  testsThatReadDocs,
  vitestArgs,
} from "./test-scope-core.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const event = process.env.GITHUB_EVENT_NAME ?? "";
const onMain = process.env.GITHUB_REF === "refs/heads/main";
const labels = JSON.parse(process.env.PR_LABELS || "[]") ?? [];

// CI checks out a test merge for a PR: its first parent is main as it stood.
const changedPaths =
  event === "pull_request"
    ? git("diff", "--name-only", "HEAD^1", "HEAD").split("\n").filter(Boolean)
    : [];

function docsReadByTests() {
  const docs = new Set();
  for (const file of testsThatReadDocs(readdirSync("src", { recursive: true }).map(String))) {
    for (const doc of docsNamedIn(readFileSync(join("src", file), "utf8"))) docs.add(doc);
  }
  return [...docs];
}

const { mode, why } = testScope({
  changedPaths,
  event,
  onMain,
  labels,
  docsReadByTests: docsReadByTests(),
});

// How many integration files the diff reaches sets how many shards it's worth.
function integrationFilesReached() {
  const listed = execFileSync(
    "npx",
    ["vitest", "list", "--filesOnly", "--changed=HEAD^1", "--passWithNoTests"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return listed.split("\n").filter((line) => line.includes(".integration.test.")).length;
}

const reached = mode === "changed" ? integrationFilesReached() : null;
const shards = shardsFor(mode, reached ?? 0);
const lines = {
  mode,
  // Empty for a docs-only run: the jobs that use it are skipped.
  shards: JSON.stringify(Array.from({ length: shards }, (_, i) => i + 1)),
  total: String(shards),
  args: vitestArgs(mode, { event, labels }),
  specs: changedSpecs(changedPaths).join(" "),
};
const out = Object.entries(lines)
  .map(([key, value]) => `${key}=${value}\n`)
  .join("");
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);
const summary = `Test scope: ${mode} (${why}). Integration files reached: ${reached ?? "n/a"}. Shards: ${shards}.\n`;
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
