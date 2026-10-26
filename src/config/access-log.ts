import type { AuditEvent } from "@/lib/audit";

// The access log (docs/security/edge.md): the audit_log entries that record who got in, who
// tried, and what changed about an account's access. Each one also keeps the time, IP address,
// browser and outcome (src/lib/audit.ts), and is deleted after RETENTION_PERIODS.accessLog.

export const ACCESS_EVENTS = [
  // Signing in and out.
  "user_signed_up",
  "user_signed_in",
  "user_signed_out",
  "sign_in_failed",
  "session_signed_out",
  "other_sessions_signed_out",
  // Two-factor.
  "mfa_enabled",
  "mfa_verified",
  "mfa_failed",
  "mfa_disabled",
  "mfa_backup_code_used",
  "mfa_backup_codes_created",
  "admin_mfa_enrolled",
  "admin_mfa_verified",
  "admin_mfa_failed",
  // Banks linked and unlinked, data taken out, accounts deleted.
  "item_linked",
  "item_relinked",
  "item_removed",
  "data_exported",
  "user_data_deleted",
  // The team: every admin page viewed and every admin action, plus the named ones.
  "admin_page_viewed",
  "admin_action",
  "admin_viewed_queue",
  "admin_viewed_action",
  "admin_viewed_metrics",
  "admin_viewed_health",
  "action_status_changed",
  "user_made_admin",
  "invite_code_created",
  "invite_code_revoked",
  "invite_redeemed",
] as const satisfies readonly AuditEvent[];

export type AccessEvent = (typeof ACCESS_EVENTS)[number];

// Entries that went wrong; everything else succeeded unless it says otherwise.
export const FAILED_EVENTS: readonly AccessEvent[] = [
  "sign_in_failed",
  "mfa_failed",
  "admin_mfa_failed",
];

// What a person sees of their own on /security, in their words.
export const ACTIVITY_LABELS: Partial<Record<AccessEvent, string>> = {
  user_signed_up: "Created your account",
  user_signed_in: "Signed in",
  user_signed_out: "Signed out",
  session_signed_out: "Signed out another device",
  other_sessions_signed_out: "Signed out all other devices",
  mfa_enabled: "Turned on two-factor",
  mfa_verified: "Entered a two-factor code",
  mfa_failed: "Wrong two-factor code",
  mfa_disabled: "Turned off two-factor",
  mfa_backup_code_used: "Used a backup code",
  mfa_backup_codes_created: "Made new backup codes",
  admin_mfa_enrolled: "Turned on two-factor",
  admin_mfa_verified: "Entered a two-factor code",
  admin_mfa_failed: "Wrong two-factor code",
  item_linked: "Linked a bank",
  item_relinked: "Reconnected a bank",
  item_removed: "Disconnected a bank",
  data_exported: "Downloaded your data",
};

// Rows on /security and per page of /admin/access-log.
export const ACTIVITY_ROWS = 20;
export const ACCESS_LOG_PAGE_SIZE = 100;

// The browser's user agent is cut to this length (as for sessions, src/config/sessions.ts).
export const ACCESS_USER_AGENT_MAX = 300;
