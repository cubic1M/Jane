#!/usr/bin/env node
// Run on a timer by .github/workflows/watch.yml: looks at the live site, and acts only on the fixed
// triggers in watch-core.mjs. Prints what it did in short codes, since the repo's logs are public.
// Exits 1 if anything fired, which also starts the reader agent (incident-reader.yml).
import { deployState, liveDeployment, productionDeploys, rollBackTo } from "./vercel.mjs";
import { decide, pageWords, probeCounts, secretFor } from "./watch-core.mjs";
import { freeze, logAction, readLog } from "./ops-log.mjs";
import { page } from "./page.mjs";

const SITE = process.env.SITE ?? "https://jane-dusky.vercel.app";
const GAP_MS = Number(process.env.OPS_CONFIRM_GAP_MS ?? 60_000);
const TRIES = 3;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let paused = false;

async function okAt(path) {
  try {
    const response = await fetch(`${SITE}${path}`, { signal: AbortSignal.timeout(20_000) });
    // The emergency stop's answer (src/proxy.ts), not a site that's broken.
    if (response.status === 503 && (await response.clone().text()).startsWith("Jane is paused")) {
      paused = true;
    }
    return response.ok;
  } catch {
    return false;
  }
}

// One bad answer isn't an outage: three in a row, a minute apart.
async function confirmedOk(path) {
  for (let attempt = 1; attempt <= TRIES; attempt += 1) {
    if (await okAt(path)) return true;
    if (attempt < TRIES) await pause(GAP_MS);
  }
  return false;
}

async function probeOnce() {
  try {
    const response = await fetch(`${SITE}/api/cron/probe`, {
      headers: { authorization: `Bearer ${process.env.PROBE_SECRET}` },
      signal: AbortSignal.timeout(120_000),
    });
    return probeCounts(await response.json().catch(() => null), response.status);
  } catch {
    return probeCounts(null);
  }
}

// Every half hour: each probe makes and removes two sample people.
const shouldProbe = () =>
  process.env.OPS_PROBE_ALWAYS === "1" || new Date().getUTCMinutes() % 30 < 10;

// Twice before it counts.
async function probe() {
  if (!process.env.PROBE_SECRET || !shouldProbe()) return null;
  const first = await probeOnce();
  if (!first || (first.leaks === 0 && first.others === 0)) return first;
  await pause(GAP_MS);
  const second = await probeOnce();
  if (!second) return null;
  return {
    leaks: Math.min(first.leaks, second.leaks),
    others: Math.min(first.others, second.others),
  };
}

async function invariants() {
  const nothing = { jobs: [], switches: [] };
  if (!process.env.OPS_READ_SECRET) return nothing;
  try {
    const response = await fetch(`${SITE}/api/ops/invariants`, {
      headers: { authorization: `Bearer ${process.env.OPS_READ_SECRET}` },
      signal: AbortSignal.timeout(20_000),
    });
    return response.ok ? await response.json() : nothing;
  } catch {
    return nothing;
  }
}

async function setSwitch(name, trigger) {
  const secret = process.env[secretFor(name)];
  if (!secret) return false;
  const response = await fetch(`${SITE}/api/ops/switches`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ switch: name, on: true, trigger }),
    signal: AbortSignal.timeout(20_000),
  });
  return response.ok;
}

// Not one step's failure may stop the next, the page least of all.
async function attempt(run) {
  try {
    return (await run()) !== false;
  } catch {
    return false;
  }
}
const logQuietly = (entry) => attempt(() => logAction(entry));

const startedAt = new Date().toISOString();
const [deployments, live] = await Promise.all([
  productionDeploys().catch(() => null),
  liveDeployment().catch(() => null),
]);
const deploy = deployState(deployments, live, startedAt);
const [app, db, inv] = await Promise.all([
  confirmedOk("/api/health"),
  confirmedOk("/api/health/db"),
  invariants(),
]);
const probed = await probe();
let log = null;
try {
  log = readLog();
} catch {
  console.log("Couldn't read the ops log.");
}
const actions = decide({
  health: { app, db, paused },
  probe: probed,
  jobs: inv.jobs,
  switches: inv.switches,
  deploy,
  log,
  now: startedAt,
});

const outcomes = [];
for (const action of actions) {
  const { trigger } = action;
  if (action.do === "switch") {
    const ok = await attempt(() => setSwitch(action.name, trigger));
    outcomes.push({ do: "switch", name: action.name, ok });
    await logQuietly({
      at: new Date().toISOString(),
      trigger,
      kind: "switch",
      name: action.name,
      ok,
    });
  } else if (action.do === "rollback") {
    const ok = await attempt(() => rollBackTo(deploy.previousUrl));
    outcomes.push({ do: "rollback", ok });
    await logQuietly({
      at: new Date().toISOString(),
      trigger,
      kind: "rollback",
      badSince: deploy.createdAt,
      to: deploy.previousUrl,
      ...(action.leak ? { leak: true } : {}),
      ok,
    });
  } else if (action.do === "freeze") {
    const ok = await attempt(() => freeze(trigger));
    outcomes.push({ do: "freeze", ok });
    await logQuietly({ at: new Date().toISOString(), trigger, kind: "freeze", ok });
  } else if (action.do === "page") {
    const ok = await attempt(() => page(pageWords(action.why, outcomes)));
    await logQuietly({ at: new Date().toISOString(), trigger, kind: "page", ok });
  }
  console.log(`${action.do} ${action.name ?? ""} (${trigger})`);
}

// So an outside dead-man's switch notices if the timer itself stops.
if (process.env.HEALTHCHECKS_PING_KEY) {
  const base = process.env.HEALTHCHECKS_URL ?? "https://hc-ping.com";
  await fetch(`${base}/${process.env.HEALTHCHECKS_PING_KEY}/jane-watch?create=1`, {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
}
console.log(`Can roll back: ${deploy?.previousUrl ? "yes" : "no"}.`);
if (actions.length === 0) console.log("Nothing to do.");
else process.exitCode = 1;
