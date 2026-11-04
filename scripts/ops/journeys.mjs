#!/usr/bin/env node
// The candidate's journeys, before it takes any traffic: docs/ops.md has where this sits in a deploy.
//   PROBE_SECRET=... VERCEL_BYPASS=... node scripts/ops/journeys.mjs https://candidate.example [commit]
// Exits 1 if any fails, and the deploy stops there. The probe runs on the candidate's own code and
// covers sign-in, the dashboard, one person not reading another, tokens, and the guardrail. Prints
// counts by default because the repo's logs are public; --names adds which ones.

/** @param {string} base @param {{ fetcher?: typeof fetch, probeSecret?: string, bypass?: string, commit?: string }} options */
export async function journeys(base, { fetcher = fetch, probeSecret, bypass, commit } = {}) {
  const extra = bypass ? { "x-vercel-protection-bypass": bypass } : {};
  const get = (path, headers = {}) =>
    fetcher(new URL(path, base), {
      redirect: "manual",
      headers: { ...extra, ...headers },
      signal: AbortSignal.timeout(120_000),
    });
  const checks = [];
  const check = async (name, run) => {
    try {
      checks.push({ name, ok: (await run()) === true });
    } catch {
      checks.push({ name, ok: false });
    }
  };
  await check("the app answers", async () => (await (await get("/api/health")).json()).ok);
  await check("it is the commit we meant to ship", async () => {
    if (!commit) return true;
    return (await (await get("/api/health")).json()).commit === commit;
  });
  await check("the database answers", async () => (await (await get("/api/health/db")).json()).ok);
  // A nonce-less page once shipped with nothing able to run on it (docs/security/edge.md).
  await check("the landing page can run its scripts", async () => {
    const response = await get("/");
    const csp = response.headers.get("content-security-policy") ?? "";
    const body = await response.text();
    return response.status === 200 && csp.includes("nonce-") && /<script[^>]+nonce=/.test(body);
  });
  await check("the probe's journeys pass", async () => {
    if (!probeSecret) return false; // No secret: nothing has been shown. A deploy shouldn't pass.
    const response = await get("/api/cron/probe", { authorization: `Bearer ${probeSecret}` });
    const result = await response.json();
    return response.status === 200 && result.ok === true;
  });
  return { ok: checks.every((c) => c.ok), checks };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [base, commit] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (!base) {
    console.error("Usage: journeys.mjs <url> [commit]");
    process.exit(2);
  }
  const result = await journeys(base, {
    probeSecret: process.env.PROBE_SECRET,
    bypass: process.env.VERCEL_BYPASS,
    commit,
  });
  const passed = result.checks.filter((c) => c.ok).length;
  console.log(`Journeys: ${passed} of ${result.checks.length} passed.`);
  if (process.argv.includes("--names")) {
    for (const c of result.checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}`);
  }
  process.exitCode = result.ok ? 0 : 1;
}
