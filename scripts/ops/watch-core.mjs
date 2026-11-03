// The fixed triggers: what the watch does about what it sees. No model, no judgement, and no log
// or error text comes in here: only counts and yes or no. A reader agent's advice never reaches it
// (docs/ops.md). What it may do is limited to: roll code back, freeze deploys, set a switch that
// only reduces exposure, page a phone. KILL_SITE takes a leak that survived a rollback. KILL_EMAIL
// has no trigger at all. It never touches a database, and a restore stays a person's call.

export const ROLLBACK_EVERY_MINUTES = 360;
export const RECENT_DEPLOY_MINUTES = 120;
export const JOB_DEPLOY_MINUTES = 26 * 60;
export const PAGE_EVERY_MINUTES = 60;

const minutesSince = (at, now) => (Date.parse(now) - Date.parse(at)) / 60_000;

const rolledBackLately = (log, now) =>
  log.some(
    (a) =>
      a.kind === "rollback" && a.ok !== false && minutesSince(a.at, now) < ROLLBACK_EVERY_MINUTES,
  );

const paged = (log, trigger, now) =>
  log.some(
    (a) =>
      a.kind === "page" && a.trigger === trigger && minutesSince(a.at, now) < PAGE_EVERY_MINUTES,
  );

// A job counts only if it worked before and failed since this deploy went live.
function jobBroken(jobs, deploy) {
  if (!deploy || deploy.ageMinutes > JOB_DEPLOY_MINUTES) return false;
  return jobs.some(
    (job) =>
      !job.lastOk &&
      job.previousOk === true &&
      Date.parse(job.lastFinishedAt) > Date.parse(deploy.createdAt),
  );
}

function triggerOf({ health, probe, jobs, deploy }) {
  if (probe?.leaks > 0)
    return { trigger: "probe", why: "a cross-user check failed twice", leak: true };
  if (!health.app || !health.db)
    return { trigger: "down", why: "the site's health check failed three times" };
  if (probe?.others > 0) return { trigger: "probe", why: "a sign-in or page check failed twice" };
  if (jobBroken(jobs, deploy))
    return { trigger: "job", why: "a scheduled job broke after this deploy" };
  return null;
}

// What to do, in order. An empty list means nothing's wrong.
export function decide({ health, probe, jobs, deploy, log, now }) {
  // A person or this script stopped the site on purpose: that isn't an outage to roll back for.
  if (health.paused) return [];
  const seen = triggerOf({ health, probe, jobs, deploy });
  if (!seen) return [];
  const { trigger, why, leak } = seen;
  const actions = [];
  const recent =
    deploy && deploy.ageMinutes <= (trigger === "job" ? JOB_DEPLOY_MINUTES : RECENT_DEPLOY_MINUTES);
  const canRollBack =
    (leak || recent) && !rolledBackLately(log, now) && Boolean(deploy?.previousUrl);

  if (leak)
    actions.push(
      { do: "switch", name: "banks", trigger },
      { do: "switch", name: "uploads", trigger },
    );
  if (canRollBack) {
    actions.push({ do: "rollback", trigger }, { do: "freeze", trigger });
  } else if (leak && rolledBackLately(log, now)) {
    // Last-good leaks as well, so code can't fix this.
    actions.push({ do: "switch", name: "site", trigger }, { do: "freeze", trigger });
  }
  if (!paged(log, trigger, now) || actions.some((a) => a.do !== "page")) {
    const did = actions.map((a) => (a.do === "switch" ? `KILL_${a.name.toUpperCase()}` : a.do));
    actions.push({
      do: "page",
      trigger,
      text: `Jane: ${why}. ${did.length ? `Did: ${did.join(", ")}.` : "Did nothing: a rollback wouldn't help or just ran."} See docs/incident.md.`,
    });
  }
  return actions;
}

// Which secret each switch needs: the only place the script reaches for the higher one.
export const secretFor = (name) => (name === "site" ? "OPS_HIGH_BAR_SECRET" : "OPS_REDUCE_SECRET");

// What a probe's answer says, with its words left behind.
export function probeCounts(result) {
  const failed = (result?.checks ?? []).filter((check) => !check.ok);
  if (!result?.checks) return { leaks: 0, others: 1 };
  return {
    leaks: failed.filter((check) => check.leak).length,
    others: failed.filter((check) => !check.leak).length,
  };
}
