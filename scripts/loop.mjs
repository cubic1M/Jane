// Run by .github/workflows/ci-finished.yml when a CI run finishes and every 15 minutes. Reads
// GitHub, applies scripts/loop-core.mjs, and records the result on the ci-loop branch: state.json
// and LOOP.md. It runs main's copy, never a PR's code, and sends ids only (docs/agent-loop.md).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LABELS,
  activeClaims,
  alarms,
  deployLag,
  fireRequest,
  keepWakes,
  plan,
  redMinutesPerDay,
  renderLoop,
  wakeText,
} from "./loop-core.mjs";

const REPO = process.env.GITHUB_REPOSITORY ?? "cubic1M/Jane";
const [OWNER, NAME] = REPO.split("/");
const BRANCH = "ci-loop";
const CLAIMS_BRANCH = "claude/task-claims";
const SITE = "https://jane-dusky.vercel.app";
const ALARM_LABEL = "loop-alarm";
const now = new Date().toISOString();

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts }).trim();
const api = (path, ...more) => run("gh", ["api", `repos/${REPO}/${path}`, ...more]);
const quietly = (work) => {
  try {
    return work();
  } catch (error) {
    console.log(`Skipped: ${error.message.split("\n")[0].slice(0, 200)}`);
    return null;
  }
};

const dir = mkdtempSync(join(tmpdir(), "loop-"));
const remote = process.env.GH_TOKEN
  ? `https://x-access-token:${process.env.GH_TOKEN}@github.com/${REPO}.git`
  : `https://github.com/${REPO}.git`;
const git = (...args) => run("git", ["-C", dir, ...args]);
git("init", "-q", "-b", BRANCH);
git("remote", "add", "origin", remote);
let state = { wakes: [], labelsMade: false };
try {
  git("fetch", "-q", "--depth=1", "origin", BRANCH);
  git("checkout", "-q", "FETCH_HEAD", "--", ".");
  state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
} catch {
  console.log(`No ${BRANCH} branch yet: starting one.`);
}

// GitHub sometimes answers a push with a server error, and a wake sent but not written down would be
// sent again.
function pushRecord() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      git("push", "-q", "--force", "origin", `HEAD:${BRANCH}`);
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      spawnSync("sleep", ["5"]);
    }
  }
}

const QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, baseRefName: "main", first: 100) {
      nodes {
        number isDraft isCrossRepository headRefName headRefOid mergeable
        author { login }
        labels(first: 30) { nodes { name } }
        commits(last: 1) { nodes { commit { committedDate statusCheckRollup { contexts(first: 100) {
          nodes { __typename ... on CheckRun { name status conclusion startedAt completedAt } }
        } } } } }
      }
    }
  }
}`;

function readPrs() {
  const data = JSON.parse(
    run("gh", [
      "api",
      "graphql",
      "-f",
      `query=${QUERY}`,
      "-f",
      `owner=${OWNER}`,
      "-f",
      `name=${NAME}`,
    ]),
  );
  return data.data.repository.pullRequests.nodes.map((pr) => {
    const commit = pr.commits.nodes[0]?.commit;
    return {
      number: pr.number,
      draft: pr.isDraft,
      fork: pr.isCrossRepository,
      dependabot: pr.author?.login.startsWith("dependabot") ?? false,
      branch: pr.headRefName,
      sha: pr.headRefOid,
      mergeable: pr.mergeable,
      labels: pr.labels.nodes.map((label) => label.name),
      committedAt: commit?.committedDate ?? now,
      checks: (commit?.statusCheckRollup?.contexts.nodes ?? []).filter(
        (check) => check.__typename === "CheckRun",
      ),
    };
  });
}

function readMainRuns() {
  const { workflow_runs: runs } = JSON.parse(
    api("actions/workflows/ci.yml/runs?branch=main&per_page=100"),
  );
  return runs
    .filter((r) => r.head_branch === "main" && r.head_repository?.full_name === REPO)
    .map((r) => ({
      id: r.id,
      sha: r.head_sha,
      status: r.status,
      conclusion: r.conclusion,
      attempt: r.run_attempt,
      completedAt: r.updated_at,
    }));
}

function readClaims() {
  const out = quietly(() => {
    const claims = mkdtempSync(join(tmpdir(), "claims-"));
    run("git", ["-C", claims, "init", "-q"]);
    run("git", ["-C", claims, "fetch", "-q", "--depth=1", remote, CLAIMS_BRANCH]);
    return run("git", ["-C", claims, "show", "FETCH_HEAD:claims.json"]);
  });
  return out ? JSON.parse(out) : [];
}

// The live site says which commit it's built from (src/config/build-commit.ts).
async function liveCommit() {
  try {
    const response = await fetch(`${SITE}/api/health`, { signal: AbortSignal.timeout(20000) });
    const { commit } = await response.json();
    return response.ok && /^[0-9a-f]{40}$/.test(commit ?? "") ? commit : null;
  } catch {
    return null;
  }
}

function isAtOrAfter(live, sha) {
  if (!live) return null;
  if (live === sha) return true;
  const status = quietly(() => api(`compare/${sha}...${live}`, "--jq", ".status"));
  if (status === null) return null;
  return status === "ahead" || status === "identical";
}

async function fire(text) {
  const { url, init } = fireRequest(process.env.LANE_WAKE_URL, process.env.LANE_WAKE_TOKEN, text);
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  // The status only: a response could echo what was sent.
  return response.status;
}

function setLabels(changes) {
  if (changes.length && !state.labelsMade) {
    for (const name of [...LABELS, ALARM_LABEL]) {
      quietly(() =>
        run("gh", ["label", "create", name, "-R", REPO, "--force", "--color", "bfd4f2"]),
      );
    }
    state.labelsMade = true;
  }
  for (const change of changes) {
    const flag = change.add ? ["--add-label", change.add] : ["--remove-label", change.remove];
    quietly(() => run("gh", ["pr", "edit", String(change.pr), "-R", REPO, ...flag]));
  }
}

function updateAlarm(found) {
  const open = quietly(() =>
    run("gh", [
      "issue",
      "list",
      "-R",
      REPO,
      "--label",
      ALARM_LABEL,
      "--state",
      "open",
      "--json",
      "number",
      "--jq",
      ".[0].number // empty",
    ]),
  );
  const link = `https://github.com/${REPO}/blob/${BRANCH}/LOOP.md`;
  if (found.length) {
    const body = `${found.map((line) => `- ${line}`).join("\n")}\n\nLast checked ${now.slice(0, 16)}Z. Numbers: ${link}. This issue closes by itself.`;
    if (open) quietly(() => run("gh", ["issue", "edit", open, "-R", REPO, "--body", body]));
    else {
      quietly(() =>
        run("gh", [
          "issue",
          "create",
          "-R",
          REPO,
          "--label",
          ALARM_LABEL,
          "--title",
          "The loop is stalled",
          "--body",
          body,
        ]),
      );
    }
  } else if (open) {
    quietly(() =>
      run("gh", [
        "issue",
        "close",
        open,
        "-R",
        REPO,
        "--comment",
        `Clear at ${now.slice(0, 16)}Z.`,
      ]),
    );
  }
}

const paused = process.env.LOOP_PAUSED === "1";
const dry = paused || !process.env.LANE_WAKE_TOKEN || !process.env.LANE_WAKE_URL;
const claims = readClaims();
const prs = readPrs();
const mainRuns = readMainRuns();
// A failed run past its first attempt has had its re-run, so that commit's failure is real.
const settledShas =
  process.env.EVENT_CONCLUSION === "failure" && Number(process.env.EVENT_ATTEMPT) >= 2
    ? [process.env.EVENT_SHA]
    : [];
const decided = plan({ prs, mainRuns, wakes: state.wakes, claims, now, settledShas, dry });

setLabels(decided.labels);
for (const wake of decided.wakes) {
  const record = { ...wake, at: now, dry };
  if (dry) {
    console.log(`Would wake: ${wakeText(wake, REPO)}`);
    state.wakes.push(record);
    continue;
  }
  try {
    const status = await fire(wakeText(wake, REPO));
    console.log(`Woke ${wake.lane} for ${wake.reason}: HTTP ${status}`);
    // A refused fire isn't a try: the next sweep sends it again.
    if (status >= 200 && status < 300) state.wakes.push({ ...record, result: String(status) });
  } catch (error) {
    console.log(`Couldn't wake ${wake.lane}: ${error.name}`);
  }
}
state.wakes = keepWakes(state.wakes, now);

const live = await liveCommit();
const newestGreen = mainRuns.find((r) => r.status === "completed" && r.conclusion === "success");
const lag = deployLag({
  runs: mainRuns,
  liveIsAtOrAfter: newestGreen ? isAtOrAfter(live, newestGreen.sha) : null,
  now,
});
const redMinutes = redMinutesPerDay(mainRuns, now);
const found = alarms({ main: decided.main, lag });
updateAlarm(found);

const page = renderLoop({
  repo: REPO,
  now,
  plan: decided,
  lag,
  redMinutes,
  wakes: state.wakes,
  claims: activeClaims(claims, now),
  dry,
});
state.numbers = {
  at: now,
  deployLagMinutes: lag.minutes,
  redMinutes,
  silent: decided.silent,
  stuck: decided.stuck,
  live,
};
writeFileSync(join(dir, "state.json"), `${JSON.stringify(state, null, 1)}\n`);
writeFileSync(join(dir, "LOOP.md"), page);
if (process.env.GITHUB_STEP_SUMMARY && existsSync(process.env.GITHUB_STEP_SUMMARY)) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, page);
}

// One commit, replaced each time, as with ci-flakes: the secret scan reads every branch.
git("add", "state.json", "LOOP.md");
git(
  "-c",
  "user.name=github-actions[bot]",
  "-c",
  "user.email=41898282+github-actions[bot]@users.noreply.github.com",
  "commit",
  "-q",
  "-m",
  `Loop, ${now.slice(0, 16)}Z`,
);
pushRecord();

// The sweep's own heartbeat, once a founder sets a free outside check (docs/agent-loop.md).
if (process.env.SWEEP_PING_URL?.startsWith("https://hc-ping.com/")) {
  await fetch(process.env.SWEEP_PING_URL, { signal: AbortSignal.timeout(10000) }).catch(() => {});
}
console.log(
  `Labels ${decided.labels.length}, wakes ${decided.wakes.length}${dry ? " (dry)" : ""}, held ${decided.held.length}, silent ${decided.silent.length}, stuck ${decided.stuck.length}.`,
);
