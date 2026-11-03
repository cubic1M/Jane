// Emergency switches (docs/incident.md). Each is off unless its environment variable is exactly
// "1", and takes effect on the next deploy. No imports, so the proxy can read it.

const SWITCHES = {
  // The whole site answers 503: pages, API routes, webhooks and scheduled jobs.
  site: "KILL_SITE",
  // No call reaches Claude.
  claude: "KILL_CLAUDE",
  // No new bank links and no syncing. Removing a bank at Plaid keeps working, so deleting an
  // account still does everything it promises. The demo bank carries on: it reaches no one.
  banks: "KILL_BANKS",
  // No statement, positions or document upload is read.
  uploads: "KILL_UPLOADS",
  // No email leaves, sign-in links included (Google sign-in still works).
  email: "KILL_EMAIL",
} as const;

export type KillSwitch = keyof typeof SWITCHES;

export const KILL_SWITCH_VARS: readonly string[] = Object.values(SWITCHES);

export function killed(name: KillSwitch): boolean {
  return process.env[SWITCHES[name]]?.trim() === "1";
}

export const SITE_PAUSED_TEXT =
  "Jane is paused for a moment while we check something. Please try again later.";
export const UPLOADS_PAUSED_TEXT =
  "Uploads are paused for a moment while we check something. Please try again later.";
