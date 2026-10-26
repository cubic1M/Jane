// Weekly digest settings.

// Timezone for people who haven't picked one.
export const DEFAULT_TIMEZONE = "America/Los_Angeles";

// Timezones offered on /settings.
export const TIMEZONES: readonly { id: string; label: string }[] = [
  { id: "America/Los_Angeles", label: "Pacific" },
  { id: "America/Denver", label: "Mountain" },
  { id: "America/Phoenix", label: "Arizona" },
  { id: "America/Chicago", label: "Central" },
  { id: "America/New_York", label: "Eastern" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "Pacific/Honolulu", label: "Hawaii" },
  { id: "Europe/London", label: "London" },
  { id: "UTC", label: "UTC" },
];

// Pages a digest link may lead to (anything else goes to the report).
export const DIGEST_LINK_PATHS = [
  "/plan",
  "/report",
  // What Jane did: its actions and alerts (/actions is hidden in the read-only beta and
  // /alerts was removed, 2026-10-26).
  "/jane",
  "/budgets",
  "/goals",
  "/net-worth",
  "/settings",
] as const;

// Budgets show in the weekly email once this share is spent (or they're over).
export const DIGEST_BUDGET_NEAR_SHARE = 0.9;

// Added to every digest link, so analytics can attribute visits.
export const DIGEST_UTM = { utm_source: "digest", utm_medium: "email", utm_campaign: "weekly" };
