// The rules behind npm run accuracy:drift and the push warning, as pure functions
// (src/gates/accuracy-drift.test.ts). The comparison is CI's own (.github/scripts/gates/core.mjs):
// what counts as worse is the same in both places.
import { BASELINE_FILES, baselineDrops } from "../.github/scripts/gates/core.mjs";

export { BASELINE_FILES };

// Where the drift result is kept, in the worktree's git dir (git rev-parse --git-path).
export const DRIFT_FILE = "accuracy-drift";

// What the scoreboards read: a push that changes one of these warns until the drift ran on it.
export const DRIFT_DIRS = [
  "src/categorize/",
  "src/detection/",
  "src/detectors/",
  "src/insights/",
  "src/profile/",
  "src/accuracy/",
];

/**
 * Each score that fell or rose, per baseline file: `committed` is what the commit's baseline says,
 * `scored` what the scoreboards give its code. A fall is anything CI's gate would call worse.
 */
export function driftOf(committed, scored) {
  const falls = [];
  const rises = [];
  for (const file of Object.keys(committed)) {
    for (const d of baselineDrops(committed[file], scored[file] ?? null))
      falls.push({ file, ...d });
    // Better is worse the other way round; a score that's new isn't a rise.
    for (const d of baselineDrops(scored[file] ?? {}, committed[file])) {
      if (d.now !== null) rises.push({ file, path: d.path, was: d.now, now: d.was });
    }
  }
  return { falls, rises };
}

const shown = (v) => (typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : String(v));

/** What the script prints, and its exit code: 1 on any fall. */
export function driftReport({ falls, rises }) {
  const lines = [];
  for (const f of falls) lines.push(`FELL ${f.file}: ${f.path} ${shown(f.was)} → ${shown(f.now)}`);
  for (const r of rises) lines.push(`ROSE ${r.file}: ${r.path} ${shown(r.was)} → ${shown(r.now)}`);
  if (falls.length === 0 && rises.length === 0) lines.push("No accuracy score moved.");
  if (falls.length > 0) {
    lines.push(
      'A fall goes in the PR body\'s first line ("Accuracy: held-out dollarError 0.75% → 1.31%, because …") and the PR opens with auto-merge off (docs/gates.md).',
    );
  }
  return { text: lines.join("\n"), exitCode: falls.length > 0 ? 1 : 0 };
}

/**
 * The push warning, or null: the branch changes what the scoreboards read, and the drift either
 * didn't run on this commit or found a fall. `record` is the drift file's text.
 */
export function pushDriftWarning({ changedPaths, head, record }) {
  if (!changedPaths.some((p) => DRIFT_DIRS.some((d) => p.startsWith(d)))) return null;
  let ran = null;
  try {
    ran = record ? JSON.parse(record) : null;
  } catch {
    ran = null;
  }
  if (!ran || ran.head !== head) {
    return "this branch changes what the accuracy scoreboards read and npm run accuracy:drift hasn't run on its last commit.";
  }
  if (Array.isArray(ran.falls) && ran.falls.length > 0) {
    const named = ran.falls
      .slice(0, 3)
      .map((f) => `${f.path} ${shown(f.was)} → ${shown(f.now)}`)
      .join("; ");
    return `accuracy fell on this commit (${named}${ran.falls.length > 3 ? "; …" : ""}): say it in the PR body's first line and open it with auto-merge off.`;
  }
  return null;
}
