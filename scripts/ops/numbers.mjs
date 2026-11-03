#!/usr/bin/env node
// Run daily by .github/workflows/numbers.yml. Reads GitHub and git, writes one page to the
// ops-numbers branch. Only numbers and PR numbers leave here. `--dry` prints the page instead.
import { execFileSync } from "node:child_process";
import {
  REWORK_DAYS,
  PROOF_OF_FIX_CHECK,
  areaOf,
  autonomy,
  deployLag,
  escapedPer100,
  parseJsonl,
  plantedCaught,
  proofOfFix,
  recoveryMinutes,
  redMainMinutes,
  renderPage,
  rework,
  rolledBack,
  staleTasks,
  usageByLane,
  versionsSeen,
  withToday,
} from "./numbers-core.mjs";
import { readData, writeData } from "./data-branch.mjs";

const REPO = process.env.GITHUB_REPOSITORY ?? "cubic1M/Jane";
const SITE = process.env.SITE ?? "https://jane-dusky.vercel.app";
const FOUNDERS = (process.env.FOUNDER_LOGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const DRY = process.argv.includes("--dry");
const MAIN = process.env.NUMBERS_MAIN ?? "origin/main";
const DAY = 86_400_000;

const now = new Date();
const nowIso = now.toISOString();
const to = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
).toISOString();
const from = new Date(Date.parse(to) - DAY).toISOString();
const dayStamp = from.slice(0, 10);

const run = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).trim();
const git = (...args) => run("git", args);
const gh = (...args) => JSON.parse(run("gh", ["api", ...args]));

function ciRuns() {
  const runs = [];
  const since = new Date(Date.parse(from) - 2 * DAY).toISOString().slice(0, 10);
  for (let page = 1; page <= 10; page += 1) {
    const { workflow_runs } = gh(
      `repos/${REPO}/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=100&page=${page}&created=%3E%3D${since}`,
    );
    runs.push(
      ...workflow_runs.map((r) => ({
        sha: r.head_sha,
        conclusion: r.conclusion,
        finishedAt: r.updated_at,
      })),
    );
    if (workflow_runs.length < 100) break;
  }
  return runs;
}

const PR_FIELDS = `
  number title body isDraft headRefName mergedAt closedAt updatedAt createdAt
  labels(first: 20) { nodes { name } }
  reviews(states: APPROVED, first: 10) { nodes { author { login } } }
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
    ... on CheckRun { name conclusion }
  } } } } } }`;

function searchPrs(query) {
  const found = [];
  let after = null;
  for (let page = 0; page < 20; page += 1) {
    const { data } = gh(
      "graphql",
      "-f",
      `query=query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: 50, after: $after) {
        pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { ${PR_FIELDS} } } } }`,
      "-f",
      `q=repo:${REPO} is:pr ${query}`,
      ...(after ? ["-f", `after=${after}`] : []),
    );
    found.push(...data.search.nodes);
    if (!data.search.pageInfo.hasNextPage) break;
    after = data.search.pageInfo.endCursor;
  }
  return found.map((pr) => ({
    number: pr.number,
    title: pr.title,
    body: pr.body,
    isDraft: pr.isDraft,
    branch: pr.headRefName,
    mergedAt: pr.mergedAt,
    closedAt: pr.closedAt,
    updatedAt: pr.updatedAt,
    labels: pr.labels.nodes.map((l) => l.name),
    approvedBy: pr.reviews.nodes.map((r) => r.author?.login).filter(Boolean),
    proofOfFix:
      pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes.find(
        (c) => c.name === PROOF_OF_FIX_CHECK,
      )?.conclusion ?? null,
  }));
}

function escapedItems() {
  const { items } = gh(
    `search/issues?q=${encodeURIComponent(`repo:${REPO} label:escaped created:${dayStamp}`)}&per_page=100`,
  );
  return items.map((i) => ({ createdAt: i.created_at }));
}

async function liveCommit() {
  try {
    const res = await fetch(`${SITE}/api/health`, { signal: AbortSignal.timeout(20_000) });
    const { commit } = await res.json();
    return commit ?? null;
  } catch {
    return null;
  }
}

function isLiveCheck(live) {
  return (sha) => {
    if (!live) return null;
    if (sha === live) return true;
    try {
      git("merge-base", "--is-ancestor", sha, live);
      return true;
    } catch {
      return false;
    }
  };
}

// One day's commits from 21 days ago, and how many of the lines they added are still in main.
function reworkCohort() {
  const days = Number(process.env.NUMBERS_REWORK_DAYS ?? REWORK_DAYS); // A dry run on a younger repo.
  const until = new Date(Date.parse(to) - days * DAY).toISOString();
  const since = new Date(Date.parse(until) - DAY).toISOString();
  const shas = new Set(
    git("log", MAIN, `--since=${since}`, `--until=${until}`, "--format=%H")
      .split("\n")
      .filter(Boolean),
  );
  const added = {};
  const surviving = {};
  const files = new Set();
  for (const sha of shas) {
    for (const line of git("show", sha, "--numstat", "--format=").split("\n")) {
      const [plus, , path] = line.split("\t");
      const area = path && areaOf(path);
      if (!area || plus === "-") continue;
      added[area] = (added[area] ?? 0) + Number(plus);
      files.add(path);
    }
  }
  for (const file of files) {
    let blame;
    try {
      blame = git("blame", "-w", "-M", "--line-porcelain", MAIN, "--", file);
    } catch {
      continue; // Deleted since: nothing of it survives.
    }
    const left = blame
      .split("\n")
      .filter((line) => shas.has(line.split(" ")[0]) && /^[0-9a-f]{40} /.test(line)).length;
    const area = areaOf(file);
    surviving[area] = (surviving[area] ?? 0) + left;
  }
  return rework(added, surviving);
}

const runs = ciRuns();
const merged = searchPrs(`is:merged merged:${dayStamp}`).filter(
  (pr) => pr.mergedAt >= from && pr.mergedAt < to,
);
const closedUnmerged = searchPrs(`is:closed is:unmerged closed:${dayStamp}`);
const open = searchPrs("is:open");
const actions = parseJsonl(readData("actions.jsonl"));
const planted = parseJsonl(readData("planted.jsonl"));
const live = await liveCommit();
const reworked = reworkCohort();
const proof = proofOfFix(merged);
const usage = usageByLane(merged);
const caught = plantedCaught(planted, from, to);
const tokenCounts = Object.values(usage.lanes);

const today = {
  day: dayStamp,
  merged: merged.length,
  deployLag: deployLag({ runs, isLive: isLiveCheck(live), now: nowIso }),
  liveCommit: live?.slice(0, 8) ?? null,
  redMain: redMainMinutes(runs, from, to),
  rolledBack: rolledBack({ merged, actions, from, to }),
  recovery: recoveryMinutes({ actions, from, to }),
  escaped: escapedPer100({ merged, escaped: escapedItems(), from, to }),
  rework: reworked.changedAgain,
  reworkByArea: reworked.byArea,
  proofOfFix: proof,
  stale: staleTasks(open, nowIso),
  unattended: autonomy({ merged, closedUnmerged, founders: FOUNDERS }).unattended,
  closedUnmerged: closedUnmerged.length,
  usage,
  tokensPerPr: tokenCounts.length
    ? Math.round(tokenCounts.reduce((sum, l) => sum + l.tokensPerPr * l.prs, 0) / usage.attributed)
    : null,
  versions: versionsSeen(merged),
  planted: caught,
  plantedCaughtPercent: caught ? Math.round((caught.caught / caught.planted) * 100) : null,
};

const page = (history, read) =>
  renderPage(history, {
    holdouts: parseJsonl(read("holdouts.jsonl")),
    canaries: parseJsonl(read("canary.jsonl")),
    now: nowIso,
  });

if (DRY) {
  const history = withToday(parseJsonl(readData("history.jsonl")), today);
  console.log(page(history, readData));
} else {
  writeData(`Numbers for ${dayStamp}`, (read) => {
    const history = withToday(parseJsonl(read("history.jsonl")), today);
    return {
      "history.jsonl": `${history.map((row) => JSON.stringify(row)).join("\n")}\n`,
      "numbers.md": page(history, read),
    };
  });
  console.log(`Wrote the numbers for ${dayStamp}.`);
}
