// Run by .github/workflows/flake-list.yml after each CI run. Adds the finished runs it hasn't seen
// to the ci-flakes branch: records.jsonl, and FLAKES.md for people to read (npm run flakes). Reports
// are read as data only, and only test names are kept: the secret scan reads every branch, so error
// text on this one could red every PR.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  flakeList,
  fromPlaywright,
  fromVitest,
  keepRecent,
  parseRecords,
  recordOf,
  renderFlakes,
} from "./flake-list-core.mjs";

const REPO = process.env.GITHUB_REPOSITORY ?? "cubic1M/Jane";
const BRANCH = "ci-flakes";
const WORKFLOW_FILES = ["ci.yml", "e2e-mobile.yml"];
const MOST_RUNS_AT_A_TIME = 15;
// Rollups repeat what their parts said.
const ROLLUP_JOBS = new Set(["Lint, typecheck and unit tests", "End-to-end tests"]);

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts }).trim();
const api = (path) => JSON.parse(run("gh", ["api", `repos/${REPO}/${path}`]));
const now = new Date().toISOString();

const dir = mkdtempSync(join(tmpdir(), "flakes-"));
const remote = process.env.GH_TOKEN
  ? `https://x-access-token:${process.env.GH_TOKEN}@github.com/${REPO}.git`
  : `https://github.com/${REPO}.git`;
const git = (...args) => run("git", ["-C", dir, ...args]);
git("init", "-q", "-b", BRANCH);
git("remote", "add", "origin", remote);
let records = [];
try {
  git("fetch", "-q", "--depth=1", "origin", BRANCH);
  git("checkout", "-q", "FETCH_HEAD", "--", ".");
  records = parseRecords(readFileSync(join(dir, "records.jsonl"), "utf8"));
} catch {
  console.log(`No ${BRANCH} branch yet: starting one.`);
}
const seen = new Set(records.map((r) => `${r.run}/${r.attempt}`));

function reportsOf(runId, attempt) {
  const { artifacts } = api(`actions/runs/${runId}/artifacts?per_page=100`);
  const suffix = `-attempt-${attempt}`;
  const reports = [];
  for (const artifact of artifacts) {
    if (!artifact.name.startsWith("results-") || !artifact.name.endsWith(suffix)) continue;
    const out = mkdtempSync(join(tmpdir(), "report-"));
    run("gh", ["run", "download", String(runId), "-R", REPO, "-n", artifact.name, "-D", out]);
    for (const file of readdirSync(out)) {
      if (!file.endsWith(".json")) continue;
      const report = JSON.parse(readFileSync(join(out, file), "utf8"));
      reports.push(report.testResults ? fromVitest(report) : fromPlaywright(report));
    }
  }
  return reports;
}

// The newest runs, attempt by attempt: a dropped event's run is picked up by the next one.
const latest = WORKFLOW_FILES.flatMap((file) => {
  try {
    return api(`actions/workflows/${file}/runs?status=completed&per_page=30`).workflow_runs;
  } catch {
    console.log(`No runs of ${file} yet.`);
    return [];
  }
});
const fresh = [];
for (const r of latest) {
  if (r.head_repository?.full_name !== REPO) continue;
  for (let attempt = 1; attempt <= r.run_attempt; attempt += 1) {
    if (!seen.has(`${r.id}/${attempt}`)) fresh.push({ r, attempt });
  }
}

let added = 0;
for (const { r, attempt } of fresh.slice(0, MOST_RUNS_AT_A_TIME)) {
  const details = api(`actions/runs/${r.id}/attempts/${attempt}`);
  const { jobs } = api(`actions/runs/${r.id}/attempts/${attempt}/jobs?per_page=50`);
  // A cancelled attempt says nothing about the tests it didn't finish. Mark it seen and move on.
  const cancelled = details.conclusion === "cancelled";
  const jobsFailed = jobs
    .filter((j) => j.conclusion === "failure" && !ROLLUP_JOBS.has(j.name))
    .map((j) => j.name);
  records.push(
    recordOf(
      {
        run: r.id,
        attempt,
        workflow: r.name,
        sha: r.head_sha.slice(0, 8),
        event: r.event,
        branch: r.head_branch,
        pr: r.pull_requests?.[0]?.number ?? null,
        at: details.run_started_at ?? r.created_at,
        conclusion: details.conclusion,
        jobsFailed: cancelled ? [] : jobsFailed,
      },
      cancelled ? [] : reportsOf(r.id, attempt),
    ),
  );
  added += 1;
}
if (added === 0) {
  console.log("Nothing new.");
  process.exit(0);
}

const countable = records.filter((r) => r.conclusion !== "cancelled");
const list = flakeList(countable, now);
const kept = keepRecent(records, now);
writeFileSync(join(dir, "records.jsonl"), kept.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(join(dir, "FLAKES.md"), renderFlakes(list, REPO, now));
if (process.env.GITHUB_STEP_SUMMARY && existsSync(process.env.GITHUB_STEP_SUMMARY)) {
  writeFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `Added ${added} attempts. Main clean on the first try: ${list.main.cleanFirstTry} of ${list.main.runs}.\n`,
  );
}

// One commit, replaced each time: the data needs no history, and the secret scan reads it all.
git("add", "records.jsonl", "FLAKES.md");
git(
  "-c",
  "user.name=github-actions[bot]",
  "-c",
  "user.email=41898282+github-actions[bot]@users.noreply.github.com",
  "commit",
  "-q",
  "-m",
  `Flake list, ${now.slice(0, 16)}Z`,
);
git("push", "-q", "--force", "origin", `HEAD:${BRANCH}`);
console.log(`Added ${added} attempts.`);
