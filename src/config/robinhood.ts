import { killed } from "./kill-switches";

// The read-only Robinhood connection (docs/setup/robinhood.md). Off unless ROBINHOOD_LINK is exactly
// "1": no button, and every route answers 404.

export const robinhoodOffered = (): boolean => process.env.ROBINHOOD_LINK?.trim() === "1";

// KILL_BANKS (docs/incident.md) stops new links and refreshes. Disconnecting keeps working.
export const robinhoodOpen = (): boolean => robinhoodOffered() && !killed("banks");

export const ROBINHOOD_NAME = "Robinhood";

// Robinhood's own addresses, as its metadata gave them on 2026-11-05.
const OFFICIAL_MCP_URL = "https://agent.robinhood.com/mcp/trading";
const OFFICIAL_METADATA_URL = "https://agent.robinhood.com/.well-known/oauth-authorization-server";
const METADATA_PATH = "/.well-known/oauth-authorization-server";
// Its one scope. There is no read-only one, which is why src/lib/robinhood/mcp-client.ts has a list.
export const ROBINHOOD_SCOPE = "internal";
// Registered with Robinhood as the way back: keep this path, or every connection must start again.
export const ROBINHOOD_CALLBACK_PATH = "/api/robinhood/callback";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function localOverride(env: Record<string, string | undefined>): URL | null {
  const raw = env.ROBINHOOD_MCP_URL?.trim();
  if (!raw || !URL.canParse(raw)) return null;
  const url = new URL(raw);
  return LOOPBACK.has(url.hostname) ? url : null;
}

// Robinhood's server. ROBINHOOD_MCP_URL replaces it only with one on this machine, for the fake
// server in the tests: an address anywhere else is ignored, so a setting can't send a person's
// tokens to another company.
export function robinhoodServer(env: Record<string, string | undefined> = process.env) {
  const local = localOverride(env);
  return local
    ? { mcpUrl: local.toString(), metadataUrl: new URL(METADATA_PATH, local).toString() }
    : { mcpUrl: OFFICIAL_MCP_URL, metadataUrl: OFFICIAL_METADATA_URL };
}

// Whether an address the server's metadata named is one tokens and codes may go to.
export function robinhoodAddressAllowed(
  address: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!URL.canParse(address)) return false;
  const url = new URL(address);
  const local = localOverride(env);
  if (local) return url.origin === local.origin;
  return (
    url.protocol === "https:" &&
    (url.hostname === "robinhood.com" || url.hostname.endsWith(".robinhood.com"))
  );
}

export const ROBINHOOD_LIMITS = {
  // One request to Robinhood.
  callTimeoutMs: 15_000,
  // Everything read for one person in one refresh.
  personBudgetMs: 60_000,
  // One night's refreshes, and how many connections it takes on.
  cronBudgetMs: 90_000,
  cronConnections: 200,
  // A connection refreshed more recently than this waits for tomorrow.
  staleHours: 20,
  // A refresh older than this was lost to a crash, so another may start.
  lockMinutes: 5,
  // Failures wait this long, doubling up to the most.
  backoffHours: 6,
  backoffMostHours: 7 * 24,
  // The most kept from one answer; a larger one fails the read.
  answerBytes: 2_000_000,
  accounts: 10,
  positions: 1_000,
  orders: 1_000,
  // How long a sign-in may take, there and back.
  signInMinutes: 10,
} as const;
