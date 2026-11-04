// The only code that holds a Vercel token, and only ever these calls: read production's deployments,
// and roll back to the one before. Code only, so a migration stays where it is
// (docs/migrations.md). Vercel's tokens can be limited to a project but not to an action, so this
// token could also deploy: it lives in the ops-actor environment, never on a machine agents use.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const API = process.env.VERCEL_API ?? "https://api.vercel.com";
// A real rollback runs the pinned CLI. The drill points VERCEL_BIN at its stand-in.
const VERCEL_CLI_VERSION = "62.2.0";

const teamQuery = () => (process.env.VERCEL_TEAM_ID ? { teamId: process.env.VERCEL_TEAM_ID } : {});
const asked = async (path, query = {}) => {
  const search = new URLSearchParams({ ...query, ...teamQuery() });
  const response = await fetch(`${API}${path}?${search}`, {
    headers: { authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
    signal: AbortSignal.timeout(20_000),
  });
  return response.ok ? response.json() : null;
};

// Deployments that have been live and can be gone back to. A candidate that never took traffic
// isn't one (docs/ops.md).
export async function productionDeploys() {
  const { VERCEL_TOKEN: token, VERCEL_PROJECT_ID: project } = process.env;
  if (!token || !project) return null;
  const answer = await asked("/v7/deployments", {
    projectId: project,
    target: "production",
    state: "READY",
    rollbackCandidate: "true",
    limit: "10",
  });
  return answer?.deployments ?? null;
}

// What the production address really points at now: the newest made isn't always the one live.
export async function liveDeployment() {
  if (!process.env.VERCEL_TOKEN) return null;
  const host = new URL(process.env.SITE ?? "https://jane-dusky.vercel.app").host;
  return asked(`/v13/deployments/${encodeURIComponent(host)}`);
}

const madeAt = (d) => d.created ?? d.createdAt;

// Where the site is, and the last deployment before it to go back to. Unknown stays unknown: with
// either answer missing it rolls nothing back.
export function deployState(deployments, live, now) {
  if (!deployments || !live?.url) return null;
  const born = madeAt(live);
  const went = typeof live.aliasAssigned === "number" ? live.aliasAssigned : born;
  const previous = deployments
    .filter((d) => d.url !== live.url && madeAt(d) < born)
    .toSorted((a, b) => madeAt(b) - madeAt(a))[0];
  return {
    createdAt: new Date(went).toISOString(),
    ageMinutes: (Date.parse(now) - went) / 60_000,
    currentUrl: `https://${live.url}`,
    previousUrl: previous ? `https://${previous.url}` : null,
  };
}

export async function rollBackTo(url) {
  const bin = process.env.VERCEL_BIN;
  const [command, prefix] = bin ? [bin, []] : ["npx", ["--yes", `vercel@${VERCEL_CLI_VERSION}`]];
  const scope = process.env.VERCEL_SCOPE ? ["--scope", process.env.VERCEL_SCOPE] : [];
  // The token goes by environment, so it never shows in a process list.
  await run(command, [...prefix, "rollback", url, "--timeout=2m", ...scope], {
    env: { ...process.env },
    timeout: 180_000,
  });
}
