#!/usr/bin/env node
// Run on a timer by .github/workflows/watch.yml: looks at the live site, and acts only on the fixed
// triggers in watch-core.mjs. Prints what it did in short codes, since the repo's logs are public.
// Exits 1 if anything fired, which also starts the reader agent (incident-reader.yml).
import { deployState, productionDeploys, rollBackTo } from "./vercel.mjs";
import { decide, probeCounts, secretFor } from "./watch-core.mjs";
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
    if (response.status === 503 && (await response.clone().text()).startsWith("Jane is paused"))
      paused = true;
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
    return probeCounts(await response.json());
  } catch {
    return probeCounts(null);
  }
}

// Twice before it counts. A leak seen once and not again still gets paged by the probe's own alert.
async function probe() {
  if (!process.env.PROBE_SECRET || !shouldProbe()) return null;
  const first = await probeOnce();
  if (first.leaks === 0 && first.others === 0) return first;
  await pause(GAP_MS);
  const second = await probeOnce();
  return {
    leaks: Math.min(first.leaks, second.leaks),
    others: Math.min(first.others, second.others),
  };
}

// Every half hour: each probe makes and removes two sample people.
const shouldProbe = () =>
  process.env.OPS_PROBE_ALWAYS === "1" || new Date().getUTCMinutes() % 30 < 10;

async function jobs() {
  if (!process.env.OPS_READ_SECRET) return [];
  try {
    const response = await fetch(`${SITE}/api/ops/invariants`, {
      headers: { authorization: `Bearer ${process.env.OPS_READ_SECRET}` },
      signal: AbortSignal.timeout(20_000),
    });
    return response.ok ? (await response.json()).jobs : [];
  } catch {
    return [];
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

const startedAt = new Date().toISOString();
const deployments = await productionDeploys().catch(() => null);
const deploy = deployState(deployments, startedAt);
const health = { app: await confirmedOk("/api/health"), db: await confirmedOk("/api/health/db") };
const observed = {
  health: { ...health, paused },
  probe: await probe(),
  jobs: await jobs(),
  deploy,
};
const actions = decide({ ...observed, log: readLog(), now: startedAt });

for (const action of actions) {
  const at = new Date().toISOString();
  const entry = { at, trigger: action.trigger };
  if (action.do === "switch") {
    logAction({
      ...entry,
      kind: "switch",
      name: action.name,
      ok: await setSwitch(action.name, action.trigger).catch(() => false),
    });
  } else if (action.do === "rollback") {
    const ok = await rollBackTo(deploy.previousUrl).then(
      () => true,
      () => false,
    );
    logAction({
      ...entry,
      kind: "rollback",
      at: new Date().toISOString(),
      badSince: deploy.createdAt,
      ok,
    });
  } else if (action.do === "freeze") {
    freeze(action.trigger);
    logAction({ ...entry, kind: "freeze" });
  } else if (action.do === "page") {
    logAction({ ...entry, kind: "page", ok: await page(action.text) });
  }
  console.log(`${action.do} ${action.name ?? ""} (${action.trigger})`);
}

// So an outside dead-man's switch notices if the timer itself stops.
if (process.env.HEALTHCHECKS_PING_KEY) {
  const base = process.env.HEALTHCHECKS_URL ?? "https://hc-ping.com";
  await fetch(`${base}/${process.env.HEALTHCHECKS_PING_KEY}/jane-watch?create=1`, {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
}
if (actions.length === 0) console.log("Nothing to do.");
else process.exitCode = 1;
