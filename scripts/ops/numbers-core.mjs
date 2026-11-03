// The eleven numbers from "Agents running Jane without humans". Plain arithmetic on what GitHub and
// git already record, no model anywhere. No thresholds yet: Jane baselines for four weeks first,
// because no published figure exists to compare with. numbers.mjs fetches, this computes.
import { fixMarking } from "../../.github/scripts/gates/core.mjs";

export const BASELINE_ENDS = "2026-12-01";
export const STALE_TASK_HOURS = 2;
export const REWORK_DAYS = 21;
// The CI job that runs .github/scripts/gates/proof.mjs on every PR marked as a fix.
export const PROOF_OF_FIX_CHECK = "Gates";

const MINUTE = 60_000;
const minutesBetween = (from, to) =>
  Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / MINUTE));

const verdicts = (runs) =>
  runs
    .filter((r) => r.conclusion === "success" || r.conclusion === "failure")
    .toSorted((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt));

// 1. How long the newest green commit has waited to go live. isLive says whether a commit is the
// live one or behind it. An unknown live commit stays unknown: never a reassuring zero.
export function deployLag({ runs, isLive, now }) {
  const newest = verdicts(runs)
    .filter((r) => r.conclusion === "success")
    .at(-1);
  if (!newest) return null;
  const live = isLive(newest.sha);
  if (live === null) return null;
  return live ? 0 : minutesBetween(newest.finishedAt, now);
}

// 2. Minutes main spent red between two times: from a failed verdict until the next green one. A
// cancelled run says nothing either way. Red carried in from before `from` counts from `from`.
export function redMainMinutes(runs, from, to) {
  let redSince = null;
  let total = 0;
  const add = (end) => {
    const start = Math.max(Date.parse(redSince), Date.parse(from));
    const stop = Math.min(Date.parse(end), Date.parse(to));
    if (stop > start) total += stop - start;
  };
  for (const run of verdicts(runs)) {
    if (run.conclusion === "failure") redSince ??= run.finishedAt;
    else if (redSince) {
      add(run.finishedAt);
      redSince = null;
    }
  }
  if (redSince) add(to);
  return Math.round(total / MINUTE);
}

const within = (at, from, to) => at != null && at >= from && at < to;

// 3. Rollbacks by the script, plus merged PRs that say they revert something.
export function rolledBack({ merged, actions, from, to }) {
  const reverts = merged.filter(
    (pr) => within(pr.mergedAt, from, to) && /^revert\b/i.test(pr.title),
  );
  const rollbacks = actions.filter((a) => a.kind === "rollback" && within(a.at, from, to));
  return reverts.length + rollbacks.length;
}

// 4. Minutes from the bad deploy going live to last-good back, per rollback. Null with none.
export function recoveryMinutes({ actions, from, to }) {
  const times = actions
    .filter((a) => a.kind === "rollback" && within(a.at, from, to) && a.badSince)
    .map((a) => minutesBetween(a.badSince, a.at));
  return times.length ? Math.max(...times) : null;
}

// 5. Bugs found after merging, per 100 merged PRs. Only counts what someone or something finds.
export function escapedPer100({ merged, escaped, from, to }) {
  const count = merged.filter((pr) => within(pr.mergedAt, from, to)).length;
  if (count === 0) return null;
  const found = escaped.filter((item) => within(item.createdAt, from, to)).length;
  return Math.round((found / count) * 1000) / 10;
}

// 6. Of the lines one day's commits added 21 days ago, the share no longer there. Inputs by area.
export function rework(added, surviving) {
  /** @type {Record<string, { added: number, changedAgain: number }>} */
  const byArea = {};
  for (const [area, lines] of Object.entries(added)) {
    if (lines === 0) continue;
    const left = Math.min(surviving[area] ?? 0, lines);
    byArea[area] = { added: lines, changedAgain: Math.round(((lines - left) / lines) * 1000) / 10 };
  }
  const totalAdded = Object.values(byArea).reduce((sum, a) => sum + a.added, 0);
  const totalLeft = Object.keys(byArea).reduce(
    (sum, area) => sum + Math.min(surviving[area] ?? 0, added[area]),
    0,
  );
  return {
    byArea,
    changedAgain: totalAdded
      ? Math.round(((totalAdded - totalLeft) / totalAdded) * 1000) / 10
      : null,
  };
}

// Which part of the repo a file belongs to, for number 6. Null: not hand-written work.
export function areaOf(path) {
  if (/^(package-lock\.json$|prisma\/migrations\/|src\/generated\/|docs\/)/.test(path)) return null;
  const parts = path.split("/");
  if (parts[0] === "src" && parts.length > 2) {
    return parts[1] === "lib" && parts.length > 3 ? `lib/${parts[2]}` : parts[1];
  }
  return parts[0] === "src" ? "src" : parts.length > 1 ? parts[0] : "root";
}

// Words that give away a fix nobody marked. A floor: Jane's titles are plain sentences, and many
// fixes say neither word.
const LOOKS_LIKE_A_FIX = /\b(fix|fixes|fixed|bug|bugs|regression|crash|crashes|broke|broken)\b/i;

// 7. Of the PRs that fix something, how many showed a test failing before and passing after.
export function proofOfFix(merged) {
  let proved = 0;
  let marked = 0;
  let unmarked = 0;
  for (const pr of merged) {
    const { isFix } = fixMarking({
      title: pr.title,
      body: pr.body,
      branch: pr.branch,
      labels: pr.labels,
    });
    if (isFix) {
      marked += 1;
      if (pr.proofOfFix === "SUCCESS") proved += 1;
    } else if (
      LOOKS_LIKE_A_FIX.test(pr.title) &&
      !/^\s*proof-of-fix:\s*none\b/im.test(pr.body ?? "")
    ) {
      unmarked += 1;
    }
  }
  const fixes = marked + unmarked;
  return {
    proved,
    marked,
    unmarked,
    rate: fixes ? Math.round((proved / fixes) * 1000) / 10 : null,
  };
}

// 8. Open work nothing has touched lately. Drafts are parked on purpose, so they don't count.
export function staleTasks(open, now) {
  const cutoff = Date.parse(now) - STALE_TASK_HOURS * 60 * MINUTE;
  return open
    .filter((pr) => !pr.isDraft && Date.parse(pr.updatedAt) < cutoff)
    .map((pr) => pr.number);
}

// 9. Merged with no founder's approval, and closed without merging.
export function autonomy({ merged, closedUnmerged, founders }) {
  const unattended = merged.filter(
    (pr) => !pr.approvedBy.some((login) => founders.includes(login)),
  );
  return { unattended: unattended.length, closedUnmerged: closedUnmerged.length };
}

// The line scripts/ops/attribution.mjs prints, and each PR's body ends with.
const AGENT_LINE =
  /^Agent:\s+lane=(\S+)\s+model=(\S+)\s+claude-code=(\S+)(?:\s+tokens=(\d+))?\s*$/m;

export function attributionOf(body) {
  const match = AGENT_LINE.exec(body ?? "");
  if (!match) return null;
  const [, lane, model, version, tokens] = match;
  return { lane, model, version, tokens: tokens ? Number(tokens) : null };
}

// 10. Tokens per merged PR by lane, from PRs that said. Also says how many did, so a thin number
// reads as thin.
export function usageByLane(merged) {
  const lanes = {};
  let attributed = 0;
  for (const pr of merged) {
    const who = attributionOf(pr.body);
    if (!who) continue;
    attributed += 1;
    lanes[who.lane] ??= { prs: 0, tokens: 0 };
    lanes[who.lane].prs += 1;
    lanes[who.lane].tokens += who.tokens ?? 0;
  }
  const perPr = Object.fromEntries(
    Object.entries(lanes).map(([lane, { prs, tokens }]) => [
      lane,
      { prs, tokensPerPr: Math.round(tokens / prs) },
    ]),
  );
  return { attributed, lanes: perPr };
}

// Merged PRs by model and Claude Code version: from inside, a product change looks like your own bug.
export function versionsSeen(merged) {
  const seen = {};
  for (const pr of merged) {
    const who = attributionOf(pr.body);
    const key = who ? `${who.model} / ${who.version}` : "not recorded";
    seen[key] = (seen[key] ?? 0) + 1;
  }
  return seen;
}

// 11. Planted bugs the reviewers caught (plan step 5). Null until that weekly run exists.
export function plantedCaught(planted, from, to) {
  const inWindow = planted.filter((p) => within(p.at, from, to));
  if (inWindow.length === 0) return null;
  const caught = inWindow.reduce((sum, p) => sum + p.caught, 0);
  const total = inWindow.reduce((sum, p) => sum + p.planted, 0);
  return { caught, planted: total };
}

// Today's record replaces any earlier one for the same day: a re-run shouldn't count twice.
export function withToday(history, today) {
  return [...history.filter((row) => row.day !== today.day), today].toSorted((a, b) =>
    a.day < b.day ? -1 : 1,
  );
}

export function parseJsonl(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

const shown = (value, unit = "") =>
  value === null || value === undefined ? "no data" : `${value}${unit}`;

function median(values) {
  const known = values.filter((v) => typeof v === "number").toSorted((a, b) => a - b);
  if (known.length === 0) return null;
  return known[Math.floor(known.length / 2)];
}

const ROWS = [
  ["1", "Deploy lag", "Is the pipeline alive?", (d) => d.deployLag, " min"],
  ["2", "Red main", "Is delivery blocked?", (d) => d.redMain, " min"],
  ["3", "Rolled back or reverted", "Did releases hold?", (d) => d.rolledBack, ""],
  ["4", "Bad deploy to last-good", "How fast is recovery?", (d) => d.recovery, " min"],
  ["5", "Escaped bugs per 100 PRs", "Is the gate leaking?", (d) => d.escaped, ""],
  ["6", "Lines changed again in 21 days", "Does the work last?", (d) => d.rework, "%"],
  ["7", "Proof-of-fix rate", "Are fixes real?", (d) => d.proofOfFix?.rate, "%"],
  ["8", "Tasks silent for 2 hours", "Is anything stuck?", (d) => d.stale?.length, ""],
  ["9a", "Merged with no founder approval", "How autonomous?", (d) => d.unattended, ""],
  ["9b", "Closed unmerged", "How much waste?", (d) => d.closedUnmerged, ""],
  ["10", "Tokens per merged PR", "Is it affordable?", (d) => d.tokensPerPr, ""],
  ["11", "Planted bugs caught", "Is review worth it?", (d) => d.plantedCaughtPercent, "%"],
];

// One page. Merged PR count appears only beside numbers 3, 5 and 6, since volume alone misleads.
/** @param {any[]} history @param {{ holdouts?: any[], canaries?: any[], now: string }} options */
export function renderPage(history, { holdouts = [], canaries = [], now }) {
  const today = history.at(-1);
  const last28 = history.slice(-28);
  const lines = [
    "# Is autonomy holding?",
    "",
    `Written by \`scripts/ops/numbers.mjs\` at ${now.slice(0, 16)}Z. No model is involved.`,
    "",
    `**Baselining until ${BASELINE_ENDS}. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. ${history.length} of 28 days recorded.`,
    "",
    "| # | Number | Answers | Last day | 28-day median |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const [id, name, answers, read, unit] of ROWS) {
    const context = ["3", "5", "6"].includes(id) ? ` (of ${today.merged ?? 0} merged)` : "";
    const typical = median(last28.map(read));
    lines.push(
      `| ${id} | ${name} | ${answers} | ${shown(read(today), unit)}${context} | ${shown(typical, unit)} |`,
    );
  }
  lines.push(
    "",
    "Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.",
  );

  const areas = Object.entries(today.reworkByArea ?? {}).toSorted(
    (a, b) => b[1].added - a[1].added,
  );
  if (areas.length) {
    lines.push(
      "",
      "## Number 6 by area",
      "",
      "| Area | Lines added | Changed again |",
      "| --- | --- | --- |",
    );
    for (const [area, { added, changedAgain }] of areas.slice(0, 12)) {
      lines.push(`| ${area} | ${added} | ${changedAgain}% |`);
    }
  }

  lines.push(
    "",
    "## Who did the work",
    "",
    "| Model / Claude Code | Merged PRs |",
    "| --- | --- |",
  );
  for (const [key, count] of Object.entries(today.versions ?? {}).toSorted((a, b) => b[1] - a[1])) {
    lines.push(`| ${key} | ${count} |`);
  }

  const holdout = holdouts.at(-1);
  lines.push(
    "",
    "## Holdout scenarios",
    "",
    holdout
      ? `Last run ${holdout.at.slice(0, 16)}Z on \`${holdout.sha}\`: ${holdout.passed} of ${holdout.total} passed.`
      : "No run recorded yet.",
    "",
    "## Daily canary task",
    "",
  );
  if (canaries.length === 0) lines.push("No run recorded yet.");
  else {
    lines.push(
      "| Day | Solved | Turns | Minutes | Model / Claude Code |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const c of canaries.slice(-7)) {
      lines.push(
        `| ${c.at.slice(0, 10)} | ${c.solved ? "yes" : "no"} | ${shown(c.turns)} | ${shown(c.minutes)} | ${c.model} / ${c.version} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
