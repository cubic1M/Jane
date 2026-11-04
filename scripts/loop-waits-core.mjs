// "I'm waiting on #N" (docs/agent-loop.md): a lane leaves a record, and the reconciler wakes it when
// that PR merges, closes unmerged, or, if it asked, goes green. Pure. A record lives on the
// claude/task-claims branch, which only people with push access can write, and its fields are
// checked here anyway, because the lane and task go into a wake.
import { LANE_LABEL, activeClaims, requiredState } from "./loop-core.mjs";

export const WAIT_HOURS = { usual: 72, most: 168 };
// Either a claim's name (pr-123) or a branch (nd/audit-fix): where the woken session picks up.
const TASK = /^[a-z0-9][a-z0-9/_.-]{0,80}$/;
const WHEN = ["merged", "green"];

export function takeWait(
  waits,
  { on, lane, task, when = "merged", hours = WAIT_HOURS.usual, now },
) {
  if (!Number.isInteger(on) || on <= 0) throw new Error(`Not a PR number: ${on}`);
  if (!LANE_LABEL.test(lane)) throw new Error(`Not a lane: ${lane}`);
  if (!TASK.test(task)) throw new Error(`Not a task or branch: ${task}`);
  if (!WHEN.includes(when)) throw new Error(`Wait for merged or green, not ${when}`);
  const expires = new Date(
    Date.parse(now) + Math.min(hours, WAIT_HOURS.most) * 3600000,
  ).toISOString();
  const others = activeClaims(waits, now).filter((w) => w.on !== on || w.task !== task);
  return [...others, { on, lane, task, when, since: now, expires }];
}

export function dropWait(waits, { on, task, now }) {
  return activeClaims(waits, now).filter((w) => w.on !== on || w.task !== task);
}

const wellFormed = (wait) =>
  Number.isInteger(wait.on) &&
  LANE_LABEL.test(wait.lane ?? "") &&
  TASK.test(wait.task ?? "") &&
  WHEN.includes(wait.when);

// Which PRs the reconciler has to look up: what it waits on and isn't among the open PRs it read.
export const prsToLookUp = (waits, openNumbers, now) => [
  ...new Set(
    activeClaims(waits, now)
      .filter(wellFormed)
      .map((wait) => wait.on)
      .filter((on) => !openNumbers.includes(on)),
  ),
];

function waitOutcome(wait, pr) {
  if (!pr) return null;
  if (pr.merged) return { reason: "waited-merged", sha: pr.mergeSha ?? pr.sha };
  if (pr.closed) return { reason: "waited-closed", sha: pr.sha };
  // A green PR hasn't landed, so someone waiting on the merge keeps waiting.
  if (wait.when === "green" && requiredState(pr.checks ?? []).state === "success") {
    return { reason: "waited-green", sha: pr.sha };
  }
  return null;
}

/**
 * The wakes these records call for. One per record: a lane that still wants to wait adds a new one.
 * A refused fire isn't recorded, so it goes again at the next sweep. A claim on the task holds it,
 * since whoever claimed it is already there.
 * @param {{waits: any[], prs: Map<number, any>, wakes: any[], claims?: any[], now: string,
 *          dry: boolean}} input
 */
export function waitWakes({ waits, prs, wakes, claims = [], now, dry }) {
  const claimed = new Set(activeClaims(claims, now).map((claim) => claim.task));
  const wanted = [];
  for (const wait of activeClaims(waits, now).filter(wellFormed)) {
    const outcome = waitOutcome(wait, prs.get(wait.on));
    if (!outcome || claimed.has(wait.task)) continue;
    const key = `${wait.on}:${wait.task}:${wait.since}`;
    if (wakes.some((w) => w.wait === key && !!w.dry === dry)) continue;
    wanted.push({ pr: wait.on, lane: wait.lane, task: wait.task, wait: key, ...outcome });
  }
  return wanted;
}

export function renderWaits(waits, wakes, now) {
  const live = activeClaims(waits, now);
  if (live.length === 0) return ["None."];
  return live.map((wait) => {
    const key = `${wait.on}:${wait.task}:${wait.since}`;
    const woken = wakes.find((w) => w.wait === key);
    return `- ${wait.lane} for ${wait.task}: #${wait.on} ${wait.when}${woken ? `, woken ${woken.at.slice(0, 16)}Z (${woken.reason}${woken.dry ? ", dry" : ""})` : ""}, until ${wait.expires.slice(0, 16)}Z`;
  });
}
