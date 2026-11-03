// Whether to ship, with no network: the same rules as the laptop's green-deploy.sh. The newest main
// commit whose CI finished green, only forward, at most once per 15 minutes and 80 per 24 hours,
// and never a commit that failed before. Used by .github/workflows/deploy.yml (docs/deploy.md).

export const DEPLOY = { gapSeconds: 900, capPerDay: 80, keepDays: 7 };
export const LIVE_PATHS = ["/", "/import", "/api/health"];

// Only a run of main itself counts. `branch=main` on GitHub's API also finds a fork's pull request
// from a branch that happens to be called main, and that must never reach production.
export function newestGreen(runs, repo) {
  return (
    runs.find(
      (run) =>
        run.status === "completed" &&
        run.conclusion === "success" &&
        run.head_branch === "main" &&
        run.head_repository?.full_name === repo &&
        (run.event === "push" || run.event === "workflow_dispatch"),
    )?.head_sha ?? null
  );
}

const wait = (reason, sha = null) => ({ action: "wait", reason, sha });

/**
 * @param {{sha: string|null, onMain: boolean, olderThanLast: boolean,
 *          track: {last?: string, times?: number[], bad?: string[]}, now: number}} input
 * `onMain` is whether main contains the commit; `olderThanLast` whether the last one shipped
 * already contains it. `now` and `times` are in seconds.
 */
export function decide({ sha, onMain, olderThanLast, track, now }) {
  if (!sha) return wait("no green run of main");
  if (!onMain) return wait("that commit isn't on main", sha);
  if (sha === track.last) return wait("already shipped", sha);
  if (track.bad?.includes(sha)) return wait("failed before", sha);
  if (olderThanLast) return wait("older than what's live", sha);
  const times = track.times ?? [];
  const newest = times.at(-1) ?? 0;
  if (now - newest < DEPLOY.gapSeconds) return wait("inside the 15-minute gap", sha);
  const lastDay = times.filter((time) => time > now - 86400).length;
  if (lastDay >= DEPLOY.capPerDay) return wait(`cap reached (${lastDay} in 24 hours)`, sha);
  return { action: "deploy", reason: "newest green commit", sha };
}

// Keeps what the rules need and a week of history, so the record stays small.
/**
 * @param {{last?: string, times?: number[], bad?: string[], log?: any[]}} track
 * @param {{sha: string, now: number, ok: boolean, id?: string}} entry
 */
export function recorded(track, { sha, now, ok, id }) {
  const since = now - DEPLOY.keepDays * 86400;
  const log = [...(track.log ?? []), { sha, at: now, ok, ...(id ? { id } : {}) }].filter(
    (entry) => entry.at > since,
  );
  return {
    ...track,
    last: ok ? sha : track.last,
    times: [...(track.times ?? []), now].filter((time) => time > since),
    bad: ok ? (track.bad ?? []) : [...(track.bad ?? []), sha].slice(-50),
    log,
  };
}

// The deployment to go back to after a bad one: an id, because old builds' addresses stay private.
export function lastGood(track) {
  return (track.log ?? []).toReversed().find((entry) => entry.ok && entry.id)?.id ?? null;
}

export const DEPLOY_ID = /^dpl_[A-Za-z0-9]+$/;
