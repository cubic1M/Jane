// Emergency switches (docs/incident.md). A switch is on if its environment variable is exactly "1",
// which takes the next deploy, or if the store says so, which takes seconds and needs no Vercel
// login (src/lib/ops-switches.ts, off unless OPS_SWITCHES=1). No imports, so the proxy can read it.

const SWITCHES = {
  // The whole site answers 503: pages, API routes, webhooks and scheduled jobs.
  site: "KILL_SITE",
  // No call reaches Claude.
  claude: "KILL_CLAUDE",
  // No new bank or Robinhood links and no syncing. Removing a bank at Plaid and disconnecting keep
  // working, so deleting an account still does everything it promises. The demo bank carries on: it
  // reaches no one.
  banks: "KILL_BANKS",
  // No statement, positions or document upload is read.
  uploads: "KILL_UPLOADS",
  // No email leaves, sign-in links included (Google sign-in still works).
  email: "KILL_EMAIL",
} as const;

export type KillSwitch = keyof typeof SWITCHES;

export const KILL_SWITCH_VARS: readonly string[] = Object.values(SWITCHES);

let stored: ReadonlySet<string> = new Set();

// What the store last said. Only src/lib/ops-switches.ts calls this.
export function rememberStoredSwitches(names: readonly string[]): void {
  stored = new Set(names);
}

const byEnv = (name: KillSwitch) => process.env[SWITCHES[name]]?.trim() === "1";

export function killed(name: KillSwitch): boolean {
  return byEnv(name) || stored.has(name);
}

export const isKillSwitch = (name: unknown): name is KillSwitch =>
  typeof name === "string" && Object.hasOwn(SWITCHES, name);

export const OPS_PATH_PREFIX = "/api/ops/";

// Whether the emergency stop applies to this path. A stop set in the store spares the ops routes,
// or nobody could turn it off without a deploy. KILL_SITE=1 spares nothing.
export function siteStoppedFor(pathname: string): boolean {
  if (byEnv("site")) return true;
  return stored.has("site") && !pathname.startsWith(OPS_PATH_PREFIX);
}

// Who may change what. A secret that can only reduce exposure can't stop webhooks or sign-in links,
// and only a founder's can turn anything back on.
export type SwitchTier = "reduce" | "high_bar" | "founder";
const REDUCES_ONLY: readonly KillSwitch[] = ["banks", "uploads", "claude"];

export function mayChange(tier: SwitchTier, name: KillSwitch, on: boolean): boolean {
  if (tier === "founder") return true;
  if (!on) return false;
  return tier === "high_bar" || REDUCES_ONLY.includes(name);
}

export const SITE_PAUSED_TEXT =
  "Jane is paused for a moment while we check something. Please try again later.";
export const UPLOADS_PAUSED_TEXT =
  "Uploads are paused for a moment while we check something. Please try again later.";
