// What the reconciler decides, with no network and no LLM: which lane each pull request belongs to,
// who to wake and why, and the numbers on LOOP.md (docs/agent-loop.md). scripts/loop.mjs does the
// reading and writing. Nothing here reads a PR's title, body or comments, or a log: strangers can
// write those, and a wake carries only ids.

export const LIMITS = {
  // Attempt 1 of a failed run gets re-run by rerun-flaky.yml, so give that time to start.
  redSettleMinutes: 10,
  // A lane gets this many tries at one problem on one commit, then a person gets the label.
  wakesPerProblem: 2,
  silentRequeues: 3,
  silentMinutes: 120,
  // The scheduled task's own limit is 30 fires an hour.
  wakesPerHour: 25,
  wakesPerRun: 5,
  redMainAlarmMinutes: 30,
  deployLagAlarmMinutes: 60,
  keepWakesDays: 7,
};

export const REQUIRED_CHECKS = [
  "Lint, typecheck and unit tests",
  "Secret scan",
  "End-to-end tests",
];
const FAILED = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

export const NEEDS_PERSON = "needs-person";
export const PARKED = "parked";
export const MAIN_LANE = "lane:debugger";
export const LANE_LABEL = /^lane:[a-z0-9-]{1,30}$/;

// The first match wins. A lane can replace the label on its own PR, and the reconciler leaves it.
const LANE_BY_BRANCH = [
  [/^nd\//, "lane:debugger"],
  [/^fix\/sec/, "lane:security"],
  [/^fix\//, "lane:debugger"],
  [/^dependabot\//, "lane:deps"],
];
export const DEFAULT_LANE = "lane:general";
export const LABELS = [
  ...new Set([...LANE_BY_BRANCH.map(([, lane]) => lane), DEFAULT_LANE, NEEDS_PERSON, PARKED]),
];

const minutes = (later, earlier) => (Date.parse(later) - Date.parse(earlier)) / 60000;

export function laneOf(pr) {
  const own = pr.labels.find((label) => LANE_LABEL.test(label));
  if (own) return own;
  return LANE_BY_BRANCH.find(([rule]) => rule.test(pr.branch))?.[1] ?? DEFAULT_LANE;
}

// Only this repo's ready PRs are anyone's task. A fork's PR never wakes anything.
export function isTask(pr) {
  return (
    !pr.draft &&
    !pr.fork &&
    !pr.dependabot &&
    !pr.labels.includes(PARKED) &&
    !pr.labels.includes("do-not-merge")
  );
}

// The newest result of each required check on the head commit.
export function requiredState(checks) {
  const found = REQUIRED_CHECKS.map((name) => checks.find((c) => c.name === name)).filter(Boolean);
  if (found.length === 0) return { state: "none" };
  const failed = found.filter((c) => FAILED.has(c.conclusion));
  if (failed.length > 0) {
    const at = failed
      .map((c) => c.completedAt ?? "")
      .sort()
      .at(-1);
    return { state: "failure", failedAt: at };
  }
  if (found.length < REQUIRED_CHECKS.length || found.some((c) => c.status !== "COMPLETED")) {
    return { state: "pending" };
  }
  return { state: "success" };
}

// When something last visibly happened on the PR. Only commits and checks count: labels and
// comments can come from anyone, or from this reconciler.
export function lastEventAt(pr) {
  const times = [pr.committedAt];
  for (const check of pr.checks) times.push(check.startedAt, check.completedAt);
  return times.filter(Boolean).sort().at(-1) ?? pr.committedAt;
}

function problemOf(pr, { now, settledShas }) {
  if (pr.mergeable === "CONFLICTING") return "conflict";
  const required = requiredState(pr.checks);
  if (required.state === "failure") {
    const settled =
      settledShas.includes(pr.sha) ||
      minutes(now, required.failedAt || now) >= LIMITS.redSettleMinutes;
    return settled ? "red" : null;
  }
  if (minutes(now, lastEventAt(pr)) >= LIMITS.silentMinutes) return "silent";
  return null;
}

const problemLimit = (reason) =>
  reason === "silent" ? LIMITS.silentRequeues : LIMITS.wakesPerProblem;

// A dry run's wakes never count against real ones, so turning wakes on starts every count at zero.
const countWakes = (wakes, wake, dry) =>
  wakes.filter(
    (w) => w.pr === wake.pr && w.sha === wake.sha && w.reason === wake.reason && !!w.dry === dry,
  ).length;

// Hold a problem until the last wake has had its time, so one failure isn't two fires in a row.
const WAKE_GAP_MINUTES = 30;
const wokenLately = (wakes, wake, now) =>
  wakes.some(
    (w) =>
      w.pr === wake.pr &&
      w.sha === wake.sha &&
      w.reason === wake.reason &&
      minutes(now, w.at) < WAKE_GAP_MINUTES,
  );

/**
 * What to do with the open PRs and main, from what GitHub says now.
 * @param {{prs: any[], mainRuns: any[], wakes: any[], claims?: any[], now: string,
 *          settledShas?: string[], dry: boolean}} input
 */
export function plan({
  prs,
  mainRuns,
  wakes,
  claims = [],
  waitWakes = [],
  now,
  settledShas = [],
  dry,
}) {
  const labels = [];
  const wanted = [];
  const redMain = [];
  const silent = [];
  const stuck = [];
  const claimed = new Set(activeClaims(claims, now).map((c) => c.task));

  for (const pr of prs) {
    const lane = laneOf(pr);
    // A draft isn't anyone's task yet, and the controller drafts are to be left alone.
    if (!pr.fork && !pr.draft && !pr.labels.some((label) => LANE_LABEL.test(label))) {
      labels.push({ pr: pr.number, add: lane });
    }
    if (!isTask(pr)) continue;
    const problem = problemOf(pr, { now, settledShas });
    if (problem === "silent") silent.push(pr.number);
    if (!problem) {
      if (pr.labels.includes(NEEDS_PERSON)) labels.push({ pr: pr.number, remove: NEEDS_PERSON });
      continue;
    }
    const wake = { pr: pr.number, sha: pr.sha, reason: problem, lane };
    if (claimed.has(`pr-${pr.number}`)) continue;
    if (countWakes(wakes, wake, dry) >= problemLimit(problem)) {
      stuck.push(pr.number);
      if (!dry && !pr.labels.includes(NEEDS_PERSON)) {
        labels.push({ pr: pr.number, add: NEEDS_PERSON });
      }
      continue;
    }
    if (!wokenLately(wakes, wake, now)) wanted.push(wake);
  }

  const main = mainState(mainRuns, now, settledShas);
  if (main.state === "red" && main.settled) {
    const wake = { pr: null, sha: main.sha, reason: "red-main", lane: MAIN_LANE, run: main.run };
    if (
      !claimed.has("main") &&
      countWakes(wakes, wake, dry) < LIMITS.wakesPerProblem &&
      !wokenLately(wakes, wake, now)
    ) {
      // Red main stops every deploy, so it goes first.
      redMain.push(wake);
    }
  }

  // Then a lane someone is waiting to hear about (scripts/loop-waits-core.mjs): one wake and done.
  wanted.unshift(...redMain, ...waitWakes);

  const lastHour = wakes.filter((w) => !!w.dry === dry && minutes(now, w.at) < 60).length;
  const room = Math.max(0, Math.min(LIMITS.wakesPerRun, LIMITS.wakesPerHour - lastHour));
  return { labels, wakes: wanted.slice(0, room), held: wanted.slice(room), silent, stuck, main };
}

// Runs newest first. Cancelled runs say nothing either way.
export function mainState(runs, now, settledShas = []) {
  const known = runs.filter((r) => r.status === "completed" && r.conclusion !== "cancelled");
  const newest = known[0];
  if (!newest) return { state: "unknown" };
  if (newest.conclusion === "success") return { state: "green", sha: newest.sha };
  const lastGreen = known.findIndex((r) => r.conclusion === "success");
  const firstRed = lastGreen === -1 ? known.at(-1) : known[lastGreen - 1];
  const settled =
    newest.attempt >= 2 ||
    settledShas.includes(newest.sha) ||
    minutes(now, newest.completedAt) >= LIMITS.redSettleMinutes;
  return {
    state: "red",
    sha: newest.sha,
    run: newest.id,
    since: firstRed.completedAt,
    settled,
    minutes: Math.round(minutes(now, firstRed.completedAt)),
  };
}

// Number 2. Red from a failed run finishing until the next good run finishes, per UTC day.
export function redMinutesPerDay(runs, now) {
  const known = runs
    .filter((r) => r.status === "completed" && r.conclusion !== "cancelled")
    .toSorted((a, b) => a.completedAt.localeCompare(b.completedAt));
  const perDay = {};
  const add = (from, to) => {
    let start = Date.parse(from);
    const end = Date.parse(to);
    while (start < end) {
      const day = new Date(start).toISOString().slice(0, 10);
      const dayEnd = Date.parse(`${day}T00:00:00Z`) + 86400000;
      const stop = Math.min(end, dayEnd);
      perDay[day] = (perDay[day] ?? 0) + (stop - start) / 60000;
      start = stop;
    }
  };
  let redSince = null;
  for (const run of known) {
    if (run.conclusion === "success") {
      if (redSince) add(redSince, run.completedAt);
      redSince = null;
    } else {
      redSince ??= run.completedAt;
    }
  }
  if (redSince) add(redSince, now);
  return Object.fromEntries(
    Object.entries(perDay)
      .map(([day, value]) => [day, Math.round(value)])
      .toSorted(([a], [b]) => b.localeCompare(a)),
  );
}

// Number 1. How long the newest green commit has waited to go live. `liveIsAtOrAfter` says whether
// the live commit is that commit or a later one; null means the live commit isn't known.
export function deployLag({ runs, liveIsAtOrAfter, now }) {
  const green = runs.find((r) => r.status === "completed" && r.conclusion === "success");
  if (!green) return { minutes: null, why: "no green run in the window" };
  if (liveIsAtOrAfter === null)
    return { minutes: null, sha: green.sha, why: "live commit unknown" };
  if (liveIsAtOrAfter) return { minutes: 0, sha: green.sha };
  return { minutes: Math.round(minutes(now, green.completedAt)), sha: green.sha };
}

export function activeClaims(claims, now) {
  return claims.filter((claim) => Date.parse(claim.expires) > Date.parse(now));
}

export function keepWakes(wakes, now) {
  return wakes.filter((w) => minutes(now, w.at) < LIMITS.keepWakesDays * 1440);
}

// IDs and addresses only. The scheduled task's saved prompt says what to do with them.
export function wakeText(wake, repo) {
  const base = `https://github.com/${repo}`;
  return [
    `reason=${wake.reason}`,
    `lane=${wake.lane}`,
    `sha=${wake.sha}`,
    wake.pr ? `pr=${base}/pull/${wake.pr}` : `branch=main`,
    wake.run ? `run=${base}/actions/runs/${wake.run}` : null,
    wake.task ? `task=${wake.task}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

const FIRE_ADDRESS =
  /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/;

// Refuses any other address, so a wrong repository variable can't send the token elsewhere.
export function fireRequest(url, token, text) {
  if (!FIRE_ADDRESS.test(url ?? ""))
    throw new Error("LANE_WAKE_URL isn't a scheduled task's address");
  return {
    url,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ text }),
    },
  };
}

export function alarms({ main, lag }) {
  const found = [];
  if (main.state === "red" && main.minutes >= LIMITS.redMainAlarmMinutes) {
    found.push(`Main has been red for ${main.minutes} minutes (run ${main.run}).`);
  }
  if (lag.minutes !== null && lag.minutes >= LIMITS.deployLagAlarmMinutes) {
    found.push(
      `The newest green commit, ${lag.sha.slice(0, 8)}, has waited ${lag.minutes} minutes to go live.`,
    );
  }
  return found;
}

const prLinks = (numbers, repo) =>
  numbers.length
    ? numbers.map((n) => `[#${n}](https://github.com/${repo}/pull/${n})`).join(", ")
    : "none";

export function renderLoop({
  repo,
  now,
  plan: decided,
  lag,
  redMinutes,
  wakes,
  claims,
  waiting = ["None."],
  dry,
}) {
  const lagText = lag.minutes === null ? `not known (${lag.why})` : `${lag.minutes} minutes`;
  const mainText =
    decided.main.state === "red" ? `red for ${decided.main.minutes} minutes` : decided.main.state;
  const lines = [
    "# The loop",
    "",
    `Updated ${now.slice(0, 16)}Z by .github/workflows/ci-finished.yml. Wakes are ${dry ? "**dry: recorded, not sent**" : "on"}. See docs/agent-loop.md.`,
    "",
    "| # | Number | Now |",
    "| --- | --- | --- |",
    `| 1 | Deploy lag: age of the newest green commit not live | ${lagText} |`,
    `| 2 | Red main, minutes today (UTC) | ${Object.values(redMinutes).length ? (redMinutes[now.slice(0, 10)] ?? 0) : 0} |`,
    `| 8 | Tasks with no event for ${LIMITS.silentMinutes} minutes | ${decided.silent.length} (${prLinks(decided.silent, repo)}) |`,
    "",
    `Main: ${mainText}. Out of tries, for a person: ${prLinks(decided.stuck, repo)}.`,
    "",
    "## Red main by day",
    "",
    ...Object.entries(redMinutes).map(([day, value]) => `- ${day}: ${value} minutes`),
    "",
    "## Claims",
    "",
    ...(claims.length
      ? claims.map((c) => `- ${c.task}: ${c.lane}, until ${c.expires.slice(0, 16)}Z`)
      : ["None."]),
    "",
    "## Waiting on a PR",
    "",
    ...waiting,
    "",
    "## Latest wakes",
    "",
    "| When | Reason | Lane | PR | Commit | Sent |",
    "| --- | --- | --- | --- | --- | --- |",
    ...wakes
      .toSorted((a, b) => b.at.localeCompare(a.at))
      .slice(0, 30)
      .map(
        (w) =>
          `| ${w.at.slice(0, 16)}Z | ${w.reason} | ${w.lane} | ${w.pr ? `#${w.pr}` : "main"} | ${w.sha.slice(0, 8)} | ${w.dry ? "dry" : (w.result ?? "yes")} |`,
      ),
    "",
  ];
  return lines.join("\n");
}

export const CLAIM_HOURS = { usual: 2, most: 6 };
const TASK_NAME = /^[a-z0-9][a-z0-9-]{0,60}$/;

// A claim says "this is mine" and ends by itself, so a dead session can't hold a task forever. The
// same lane can renew its own. Expired claims go whenever anyone writes.
export function takeClaim(claims, { task, lane, hours = CLAIM_HOURS.usual, now }) {
  if (!TASK_NAME.test(task)) throw new Error(`Not a task name: ${task}`);
  if (!LANE_LABEL.test(lane)) throw new Error(`Not a lane: ${lane}`);
  const live = activeClaims(claims, now);
  const holder = live.find((claim) => claim.task === task);
  if (holder && holder.lane !== lane) return { ok: false, holder, claims: live };
  const expires = new Date(
    Date.parse(now) + Math.min(hours, CLAIM_HOURS.most) * 3600000,
  ).toISOString();
  return {
    ok: true,
    claims: [...live.filter((claim) => claim.task !== task), { task, lane, expires }],
  };
}

export function releaseClaim(claims, task, now) {
  return activeClaims(claims, now).filter((claim) => claim.task !== task);
}
