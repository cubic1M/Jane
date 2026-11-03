#!/usr/bin/env node
// A timed drill of step 10 on a local production build, sample data only. Everything Vercel would do
// is a stand-in: a front door that plays the production domain, a list of deployments, and a `vercel`
// that repoints the door. Run `next build` first, then:
//   DRILL_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/some_scratch node scripts/ops/drill.mjs
// It refuses any database that isn't on this machine. Writes its timings to stdout as a table.
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { journeys } from "./journeys.mjs";

const URL_ = process.env.DRILL_DATABASE_URL;
if (!URL_ || !/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/.test(URL_)) {
  console.error("Set DRILL_DATABASE_URL to a scratch database on this machine.");
  process.exit(2);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
const GOOD = 4101;
// A second instance of the good build: on Vercel, whichever instance takes the call isn't the one
// serving the next request, so switches are set here and timed there.
const OTHER = 4106;
const BAD = 4102;
const LEAKY = 4103;
const DOOR = 4100;
const VERCEL = 4104;
const PAGER = 4105;
const CONTROL = `http://localhost:${DOOR}/__control`;
const GAP_MS = process.env.DRILL_GAP_MS ?? "60000";

const secrets = {
  PROBE_SECRET: "drill-probe",
  OPS_READ_SECRET: "drill-read",
  OPS_REDUCE_SECRET: "drill-reduce",
  OPS_HIGH_BAR_SECRET: "drill-high",
  OPS_FOUNDER_SECRET: "drill-founder",
};
const appEnv = {
  ...process.env,
  ...secrets,
  NODE_ENV: "production",
  DIRECT_URL: URL_,
  AUTH_SECRET: "drill-auth-secret-not-a-real-one",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  AUTH_TRUST_HOST: "true",
  AUTH_RESEND_KEY: "drill",
  RESEND_API_KEY: "drill",
  EMAIL_FROM: "drill@example.com",
  OPS_SWITCHES: "1",
  PLAID_CLIENT_ID: "drill",
  PLAID_SECRET: "drill",
  ANTHROPIC_API_KEY: "",
};

const results = [];
const note = (what, seconds, detail = "") => {
  results.push({ what, seconds: Math.round(seconds * 10) / 10, detail });
  console.log(`${what}: ${Math.round(seconds * 10) / 10}s ${detail}`);
};
const since = (start) => (Date.now() - start) / 1000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const children = [];
function startApp(port, databaseUrl) {
  const child = spawn("npx", ["next", "start", "-p", String(port)], {
    env: { ...appEnv, DATABASE_URL: databaseUrl, AUTH_URL: `http://localhost:${port}` },
    stdio: "ignore",
    detached: true,
  });
  children.push(child);
}
const stopAll = () => {
  for (const child of children) {
    try {
      process.kill(-child.pid);
    } catch {}
  }
};
process.on("exit", stopAll);

async function waitFor(check, limitMs, label) {
  const start = Date.now();
  while (Date.now() - start < limitMs) {
    try {
      if (await check()) return since(start);
    } catch {}
    await pause(100);
  }
  throw new Error(`Timed out: ${label}`);
}

// The production domain: forwards everything to whichever deployment is current.
let target = GOOD;
const buffer = async (req) => {
  const parts = [];
  for await (const part of req) parts.push(part);
  return Buffer.concat(parts);
};
const forward = async (req, res, port) => {
  const body = await buffer(req);
  const response = await fetch(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers: { ...req.headers, host: `localhost:${port}` },
    body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
    redirect: "manual",
  }).catch(() => null);
  if (!response) {
    res.writeHead(502).end();
    return;
  }
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
};
createServer(async (req, res) => {
  if (req.url.startsWith("/__control/")) {
    target = Number(req.url.split("/").pop());
    res.end("ok");
    return;
  }
  await forward(req, res, target);
}).listen(DOOR);

// A build with a leak: answers the probe with a failed cross-user check, like a real one would.
// Everything else goes to the good build, so the health check and switches still work.
createServer(async (req, res) => {
  if (req.url.startsWith("/api/cron/probe")) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, checks: [{ name: "x", ok: false, leak: true }] }));
    return;
  }
  await forward(req, res, GOOD);
}).listen(LEAKY);

// Vercel's list of production deployments.
const NOW = Date.now();
let deployments = [];
createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ deployments }));
}).listen(VERCEL);

// A phone.
const pages = [];
createServer(async (req, res) => {
  pages.push({ at: Date.now(), text: (await buffer(req)).toString() });
  res.end("ok");
}).listen(PAGER);

// `vercel rollback <url>`: repoint the door at that deployment.
const dir = mkdtempSync(join(tmpdir(), "ops-drill-"));
const fakeVercel = join(dir, "vercel");
writeFileSync(
  fakeVercel,
  `#!/bin/sh\n[ "$1" = rollback ] || exit 9\nport=$(echo "$2" | sed 's/.*:\\([0-9]*\\).*/\\1/')\ncurl -s "${CONTROL}/$port" >/dev/null\n`,
);
chmodSync(fakeVercel, 0o755);

function watchEnv(logFile) {
  return {
    ...process.env,
    ...secrets,
    SITE: `http://localhost:${DOOR}`,
    OPS_LOG_FILE: logFile,
    OPS_PAGE_URL: `http://localhost:${PAGER}`,
    OPS_CONFIRM_GAP_MS: GAP_MS,
    OPS_PROBE_ALWAYS: "1",
    VERCEL_API: `http://localhost:${VERCEL}`,
    VERCEL_TOKEN: "drill",
    VERCEL_PROJECT_ID: "drill",
    VERCEL_BIN: fakeVercel,
  };
}
const runWatch = (logFile) =>
  run("node", [join(HERE, "watch.mjs")], { env: watchEnv(logFile) }).then(
    ({ stdout }) => ({ code: 0, stdout }),
    (error) => ({ code: error.code, stdout: error.stdout }),
  );
const deploysFor = (current, previous) => [
  { url: `localhost:${current}`, created: Date.now() - 60_000 },
  { url: `localhost:${previous}`, created: NOW - 3_600_000 },
];

const SITE = `http://localhost:${DOOR}`;
const direct = `http://localhost:${GOOD}`;
const setSwitch = (name, on, secret) =>
  fetch(`http://localhost:${OTHER}/api/ops/switches`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ switch: name, on, trigger: "drill" }),
  });
const clearAll = async () => {
  for (const name of ["site", "banks", "uploads", "claude", "email"]) {
    await setSwitch(name, false, secrets.OPS_FOUNDER_SECRET);
  }
};

// A signed-in sample person, so bank linking gets as far as the switch.
const client = new pg.Client({ connectionString: URL_ });
await client.connect();
const person = `trial_drill_person${NOW}`;
const session = `trial_drill${NOW}`;
const termsVersion = /TERMS_VERSION = "([^"]+)"/.exec(
  readFileSync("src/config/legal.ts", "utf8"),
)?.[1];
await client.query(
  "INSERT INTO users (id, email, name, terms_version, terms_accepted_at, updated_at) VALUES ($1, $2, 'Sample person', $3, now(), now())",
  [person, `${person}@try.jane.invalid`, termsVersion],
);
await client.query(
  "INSERT INTO sessions (id, session_token, user_id, expires) VALUES ($1, $2, $3, now() + interval '1 hour')",
  [session, session, person],
);
const cookie = `__Secure-authjs.session-token=${session}; authjs.session-token=${session}`;

try {
  startApp(GOOD, URL_);
  startApp(OTHER, URL_);
  startApp(BAD, "postgresql://nobody:nothing@localhost:1/none");
  const started = Date.now();
  await waitFor(async () => (await fetch(`${direct}/api/health`)).ok, 120_000, "good build");
  await waitFor(
    async () => (await fetch(`http://localhost:${OTHER}/api/health`)).ok,
    120_000,
    "second instance",
  );
  await waitFor(
    async () => (await fetch(`http://localhost:${BAD}/api/health`)).ok,
    120_000,
    "bad build",
  );
  note("Two builds up", since(started));
  await clearAll();

  // 1. Pre-traffic journeys.
  let start = Date.now();
  const onGood = await journeys(direct, { probeSecret: secrets.PROBE_SECRET });
  note(
    "Journeys on a good candidate",
    since(start),
    onGood.ok ? "passed" : `FAILED ${JSON.stringify(onGood.checks.filter((c) => !c.ok))}`,
  );
  start = Date.now();
  const onBad = await journeys(`http://localhost:${BAD}`, { probeSecret: secrets.PROBE_SECRET });
  note("Journeys on a bad candidate", since(start), onBad.ok ? "PASSED, WRONG" : "stopped it");
  start = Date.now();
  const onLeaky = await journeys(`http://localhost:${LEAKY}`, {
    probeSecret: secrets.PROBE_SECRET,
  });
  note("Journeys on a leaky candidate", since(start), onLeaky.ok ? "PASSED, WRONG" : "stopped it");

  // 2. Each switch, from the call to the site's answer changing, with no restart.
  // Polling this fast would hit its rate limit, whose 429 comes before the switch's 503.
  const linkToken = async () => {
    await client.query("DELETE FROM rate_limits");
    return fetch(`${direct}/api/plaid/link-token`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: "{}",
    });
  };
  const before = (await linkToken()).status;
  console.log(`link-token before the switch: ${before}`);
  start = Date.now();
  const setBanks = await setSwitch("banks", true, secrets.OPS_REDUCE_SECRET);
  console.log(`set KILL_BANKS: ${setBanks.status} ${await setBanks.text()}`);
  const banks = await waitFor(async () => (await linkToken()).status === 503, 30_000, "KILL_BANKS");
  note("KILL_BANKS set to refusing", banks, `link-token ${before} then 503`);
  await setSwitch("banks", false, secrets.OPS_FOUNDER_SECRET);
  const backOn = await waitFor(
    async () => (await linkToken()).status !== 503,
    30_000,
    "banks back",
  );
  note("KILL_BANKS cleared to working", backOn);

  start = Date.now();
  await setSwitch("site", true, secrets.OPS_HIGH_BAR_SECRET);
  const site = await waitFor(
    async () => (await fetch(`${direct}/`)).status === 503,
    30_000,
    "KILL_SITE",
  );
  note("KILL_SITE set to 503", site);
  const opsDoor = await fetch(`${direct}/api/ops/switches`, {
    headers: { authorization: `Bearer ${secrets.OPS_FOUNDER_SECRET}` },
  });
  note("Ops door open during the stop", 0, `HTTP ${opsDoor.status}`);
  await setSwitch("site", false, secrets.OPS_FOUNDER_SECRET);
  const siteBack = await waitFor(
    async () => (await fetch(`${direct}/`)).status === 200,
    30_000,
    "site back",
  );
  note("KILL_SITE cleared to 200", siteBack);

  const refused = await setSwitch("site", true, secrets.OPS_REDUCE_SECRET);
  const refusedOff = await setSwitch("site", false, secrets.OPS_REDUCE_SECRET);
  note("Reduce secret on KILL_SITE", 0, `set ${refused.status}, clear ${refusedOff.status}`);

  // 3. A bad build goes live: a rollback by the plain script, from its start to the door being good.
  const log1 = join(dir, "log1.jsonl");
  await fetch(`${CONTROL}/${BAD}`);
  deployments = deploysFor(BAD, GOOD);
  start = Date.now();
  const first = await runWatch(log1);
  const back = target === GOOD && (await fetch(`${SITE}/api/health/db`)).ok;
  note(
    "Bad build to last-good, watch's own run",
    since(start),
    `exit ${first.code}, door ${back ? "good" : "STILL BAD"}, gap ${GAP_MS}ms`,
  );
  note("  did", 0, first.stdout.trim().replace(/\n/g, "; "));
  note("  paged", 0, `${pages.length} page(s): ${pages.at(-1)?.text ?? "none"}`);
  const again = await runWatch(log1);
  note("Next run, all well", 0, `exit ${again.code}: ${again.stdout.trim()}`);

  // 4. A leak: stops new data at once and rolls back.
  const log2 = join(dir, "log2.jsonl");
  await fetch(`${CONTROL}/${LEAKY}`);
  deployments = deploysFor(LEAKY, GOOD);
  start = Date.now();
  const leak = await runWatch(log2);
  note(
    "Leak to last-good",
    since(start),
    `exit ${leak.code}, door ${target === GOOD ? "good" : "STILL LEAKY"}`,
  );
  note("  did", 0, leak.stdout.trim().replace(/\n/g, "; "));
  const stoppedBanks = await waitFor(
    async () => (await linkToken()).status === 503,
    30_000,
    "banks after leak",
  );
  note("  banks refused after the leak", stoppedBanks);

  // 5. Last-good leaks too: rolling back again can't help, so the higher bar is met.
  await fetch(`${CONTROL}/${LEAKY}`);
  const leak2 = await runWatch(log2);
  note("Leak survives the rollback", 0, leak2.stdout.trim().replace(/\n/g, "; "));
  const stopped = await waitFor(
    async () => (await fetch(`${direct}/`)).status === 503,
    30_000,
    "site after leak",
  );
  note("  KILL_SITE took effect", stopped);
  await clearAll();

  const entries = readFileSync(log2, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  note(
    "Logged actions",
    0,
    entries.map((e) => `${e.kind}${e.name ? `:${e.name}` : ""}`).join(", "),
  );
} finally {
  await clearAll().catch(() => null);
  await client.query("DELETE FROM users WHERE id = $1", [person]).catch(() => null);
  await client.end();
  stopAll();
}
console.log("\nDrill finished.");
console.log(JSON.stringify(results));
process.exit(0);
