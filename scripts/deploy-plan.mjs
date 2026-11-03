// Run by .github/workflows/deploy.yml. `plan` says whether to ship and, in a dry run, notes that it
// would have. `record ok|bad <sha> [deployment id]` writes down what happened. `last-good` prints
// the deployment to go back to. The record is on the ci-deploy branch, one commit replaced each
// time, with commit ids, times and deployment ids only.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEPLOY_ID, decide, lastGood, newestGreen, recorded } from "./deploy-plan-core.mjs";

const REPO = process.env.GITHUB_REPOSITORY ?? "cubic1M/Jane";
const BRANCH = "ci-deploy";
const SITE = "https://jane-dusky.vercel.app";
const MODE = process.env.DEPLOY_MODE === "live" ? "live" : "dry";
const now = Math.floor(Date.now() / 1000);

const run = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const api = (path, ...more) => run("gh", ["api", `repos/${REPO}/${path}`, ...more]);

const dir = mkdtempSync(join(tmpdir(), "deploy-"));
const remote = process.env.GH_TOKEN
  ? `https://x-access-token:${process.env.GH_TOKEN}@github.com/${REPO}.git`
  : `https://github.com/${REPO}.git`;
const git = (...args) => run("git", ["-C", dir, ...args]);
git("init", "-q", "-b", BRANCH);
git("remote", "add", "origin", remote);
let state = { dry: {}, live: {} };
try {
  git("fetch", "-q", "--depth=1", "origin", BRANCH);
  git("checkout", "-q", "FETCH_HEAD", "--", ".");
  state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
} catch {
  console.log(`No ${BRANCH} branch yet: starting one.`);
}

function save(message) {
  writeFileSync(join(dir, "state.json"), `${JSON.stringify(state, null, 1)}\n`);
  git("add", "state.json");
  git(
    "-c",
    "user.name=github-actions[bot]",
    "-c",
    "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "commit",
    "-q",
    "-m",
    message,
  );
  git("push", "-q", "--force", "origin", `HEAD:${BRANCH}`);
}

// ahead: `head` has everything in `base`. identical: the same commit.
function contains(head, base) {
  const status = api(`compare/${base}...${head}`, "--jq", ".status");
  return status === "ahead" || status === "identical";
}

async function liveCommit() {
  try {
    const response = await fetch(`${SITE}/api/health`, { signal: AbortSignal.timeout(20000) });
    const { commit } = await response.json();
    return response.ok && /^[0-9a-f]{40}$/.test(commit ?? "") ? commit : null;
  } catch {
    return null;
  }
}

async function plan() {
  const { workflow_runs: runs } = JSON.parse(
    api("actions/workflows/ci.yml/runs?branch=main&status=completed&per_page=30"),
  );
  const sha = newestGreen(runs, REPO);
  const track = state[MODE] ?? {};
  // Live, the site itself says what it runs, so a cutover needs no state from the laptop.
  const last = MODE === "live" ? ((await liveCommit()) ?? track.last) : track.last;
  const decided = decide({
    sha,
    onMain: sha ? contains("main", sha) : false,
    olderThanLast: sha && last && sha !== last ? contains(last, sha) : false,
    track: { ...track, last },
    now,
  });
  console.log(`${MODE}: ${decided.action} ${decided.sha?.slice(0, 8) ?? ""} (${decided.reason})`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `action=${decided.action}\nsha=${decided.sha ?? ""}\nmode=${MODE}\n`,
    );
  }
  if (MODE === "dry" && decided.action === "deploy") {
    state.dry = recorded(track, { sha: decided.sha, now, ok: true });
    save(`Would ship ${decided.sha.slice(0, 8)}`);
  }
}

function record([result, sha, id]) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? "") || (result !== "ok" && result !== "bad")) {
    throw new Error("Use: deploy-plan.mjs record ok|bad <sha> [deployment id]");
  }
  const kept = id && DEPLOY_ID.test(id) ? id : undefined;
  state.live = recorded(state.live ?? {}, { sha, now, ok: result === "ok", id: kept });
  save(`${result === "ok" ? "Shipped" : "Failed"} ${sha.slice(0, 8)}`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "plan") await plan();
else if (command === "record") record(rest);
else if (command === "last-good") console.log(lastGood(state.live ?? {}) ?? "");
else throw new Error("Use: deploy-plan.mjs plan | record | last-good");
