// The only code that holds a Vercel token, and only ever these two calls: list production
// deployments, and roll back to the one before. Code only, so a migration stays where it is
// (docs/migrations.md). Vercel's tokens can be limited to a project but not to an action, so this
// token could also deploy: it lives in the ops-actor environment, never on a machine agents use.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const API = process.env.VERCEL_API ?? "https://api.vercel.com";
// A real rollback runs the pinned CLI. The drill points VERCEL_BIN at its stand-in.
const VERCEL_CLI_VERSION = "62.2.0";

export async function productionDeploys() {
  const { VERCEL_TOKEN: token, VERCEL_PROJECT_ID: project, VERCEL_TEAM_ID: team } = process.env;
  if (!token || !project) return null;
  const query = new URLSearchParams({
    projectId: project,
    target: "production",
    state: "READY",
    limit: "5",
  });
  if (team) query.set("teamId", team);
  const response = await fetch(`${API}/v6/deployments?${query}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return null;
  const { deployments } = await response.json();
  return deployments.toSorted((a, b) => b.created - a.created);
}

export function deployState(deployments, now) {
  const [current, previous] = deployments ?? [];
  if (!current) return null;
  return {
    createdAt: new Date(current.created).toISOString(),
    ageMinutes: (Date.parse(now) - current.created) / 60_000,
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
