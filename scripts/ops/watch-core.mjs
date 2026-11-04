// The fixed triggers: what the watch does about what it sees. No model, no judgement, and no log
// or error text comes in here: only counts and yes or no. A reader agent's advice never reaches it
// (docs/ops.md). What it may do is limited to: roll code back, freeze deploys, set a switch that
// only reduces exposure, page a phone. KILL_SITE takes a leak that survived its own rollback.
// KILL_EMAIL has no trigger at all. It never touches a database, and a restore stays a person's call.

export const ROLLBACK_EVERY_MINUTES = 360;
export const RECENT_DEPLOY_MINUTES = 120;
export const JOB_DEPLOY_MINUTES = 26 * 60;
export const PAGE_EVERY_MINUTES = 60;
// One job failing is usually its vendor. Several at once, since a deploy, is usually the deploy.
export const JOBS_BROKEN_TO_ROLL_BACK = 2;

const minutesSince = (at, now) => (Date.parse(now) - Date.parse(at)) / 60_000;

const rollbacksWithin = (log, now) =>
  log.filter(
    (a) =>
      a.kind === "rollback" && a.ok !== false && minutesSince(a.at, now) < ROLLBACK_EVERY_MINUTES,
  );

const paged = (log, trigger, now) =>
  log.some(
    (a) =>
      a.kind === "page" && a.trigger === trigger && minutesSince(a.at, now) < PAGE_EVERY_MINUTES,
  );

// A job counts only if it worked before and failed since this deploy went live. The probe has its
// own confirmed trigger.
function jobsBroken(jobs, deploy) {
  if (!deploy || deploy.ageMinutes > JOB_DEPLOY_MINUTES) return 0;
  return jobs.filter(
    (job) =>
      job.name !== "probe" &&
      !job.lastOk &&
      job.previousOk === true &&
      Date.parse(job.lastFinishedAt) > Date.parse(deploy.createdAt),
  ).length;
}

function seenTrigger({ health, probe, jobs, deploy }) {
  if (probe?.leaks > 0) {
    return { trigger: "probe", why: "a cross-user check failed twice", leak: true };
  }
  if (!health.app || !health.db) {
    return { trigger: "down", why: "the site's health check failed three times" };
  }
  if (probe?.others > 0) return { trigger: "probe", why: "a sign-in or page check failed twice" };
  const broken = jobsBroken(jobs, deploy);
  if (broken >= JOBS_BROKEN_TO_ROLL_BACK) {
    return { trigger: "job", why: `${broken} scheduled jobs broke after this deploy` };
  }
  if (broken === 1) {
    return { trigger: "job", why: "a scheduled job broke after this deploy", pageOnly: true };
  }
  return null;
}

// What to do, in order, and what to tell a person. An empty list means nothing needs doing. `log` is
// null when it couldn't be read: then the limits are unknown, so nothing that has a limit runs.
/** @param {{ health: any, probe: any, jobs: any[], deploy: any, log: any[] | null, switches?: string[], now: string }} seen */
export function decide({ health, probe, jobs, deploy, log, switches = [], now }) {
  // A person or this script stopped the site on purpose: that isn't an outage to roll back for.
  if (health.paused) return [];
  const seen = seenTrigger({ health, probe, jobs, deploy });
  if (!seen) return [];
  const { trigger, why, leak, pageOnly } = seen;
  const actions = [];
  const stop = (name) => {
    if (!switches.includes(name)) actions.push({ do: "switch", name, trigger });
  };

  if (leak) {
    stop("banks");
    stop("uploads");
  }
  if (log) {
    const recentRollbacks = rollbacksWithin(log, now);
    const leakRollbacks = recentRollbacks.filter((a) => a.leak);
    const canGoBack = Boolean(deploy?.previousUrl);
    const recent =
      deploy &&
      deploy.ageMinutes <= (trigger === "job" ? JOB_DEPLOY_MINUTES : RECENT_DEPLOY_MINUTES);
    if (leak) {
      // The code we went back to for a leak is still leaking: code can't fix this.
      if (deploy && leakRollbacks.some((a) => a.to && a.to === deploy.currentUrl)) stop("site");
      else if (canGoBack && leakRollbacks.length === 0) {
        actions.push({ do: "rollback", trigger, leak: true });
      }
    } else if (!pageOnly && recent && canGoBack && recentRollbacks.length === 0) {
      actions.push({ do: "rollback", trigger });
    }
    if (actions.some((a) => a.do === "rollback" || a.name === "site")) {
      actions.push({ do: "freeze", trigger });
    }
  }
  const acted = actions.length > 0;
  if (acted || !log || !paged(log, trigger, now)) actions.push({ do: "page", trigger, why });
  return actions;
}

// One line of the public log. A deployment's address and time come from Vercel's answer, so each
// field must have its shape, and anything else stays out. A bad field goes, not the line: the
// rollback limit still has to count it.
const WORD = /^[a-z]{1,20}$/;
const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const ADDRESS = /^https:\/\/[a-z0-9.-]{1,253}(:\d{1,5})?$/i;
const LOG_TEXT = { at: TIME, kind: WORD, trigger: WORD, name: WORD, badSince: TIME, to: ADDRESS };

export function logLine(entry) {
  const kept = {};
  for (const [field, shape] of Object.entries(LOG_TEXT)) {
    if (typeof entry[field] === "string" && shape.test(entry[field])) kept[field] = entry[field];
  }
  for (const field of ["leak", "ok"]) {
    if (typeof entry[field] === "boolean") kept[field] = entry[field];
  }
  return `${JSON.stringify(kept)}\n`;
}

// The words for a phone, from what really happened, not what was meant to.
export function pageWords(why, outcomes) {
  const say = (o) => (o.do === "switch" ? `KILL_${o.name.toUpperCase()}` : o.do);
  const done = outcomes.filter((o) => o.ok).map(say);
  const failed = outcomes.filter((o) => !o.ok).map(say);
  const parts = [`Jane: ${why}.`];
  parts.push(done.length ? `Did: ${done.join(", ")}.` : "Did nothing by itself.");
  if (failed.length) parts.push(`FAILED: ${failed.join(", ")}. Do these by hand.`);
  parts.push("See docs/incident.md.");
  return parts.join(" ");
}

// Which secret each switch needs: the only place the script reaches for the higher one.
export const secretFor = (name) => (name === "site" ? "OPS_HIGH_BAR_SECRET" : "OPS_REDUCE_SECRET");

// What a probe's answer says, with its words left behind. Refused means the probe couldn't run, which
// says nothing about the site. Any other answer without its checks is a failed check.
export function probeCounts(result, status) {
  if (status === 401 || status === 403) return null;
  if (!result?.checks) return { leaks: 0, others: 1 };
  const failed = result.checks.filter((check) => !check.ok);
  return {
    leaks: failed.filter((check) => check.leak).length,
    others: failed.filter((check) => !check.leak).length,
  };
}
