// What the founders hear about besides thrown server errors (src/lib/ops-alerts.ts). Urgent kinds
// email at once, at most once per kind each OPS_ALERT_MINUTES; every kind is counted in one daily
// email, sent only on a day something happened.

export const OPS_EVENT_KINDS = {
  // People can't get in: the sign-in link didn't go out.
  sign_in_email_failed: { label: "sign-in emails didn't send", urgent: true },
  // Plaid's news was lost or answered with a 500 (Plaid retries, but the cause is ours).
  plaid_webhook_failed: { label: "Plaid webhooks failed", urgent: true },
  // A webhook whose signature didn't check out: an attacker, or verification itself broken.
  plaid_webhook_unverified: { label: "Plaid webhooks refused (bad signature)", urgent: false },
  // A bank's data didn't come in (an outage, a rate limit, or our bug).
  plaid_sync_failed: { label: "Plaid syncs failed", urgent: false },
  // A bank needs the person to sign in again (Link's update mode); Jane shows them a prompt.
  bank_connection_broken: {
    label: "bank connections broke (person asked to sign in)",
    urgent: false,
  },
  // Plaid will disconnect a bank in about 7 days unless the person signs in again.
  bank_disconnect_pending: { label: "bank connections will end in 7 days", urgent: false },
  // A notice about a Gmail mailbox without Google's signed token for us: an attacker, or
  // verification itself broken.
  gmail_webhook_unverified: {
    label: "Gmail notices refused (not signed by Google for us)",
    urgent: false,
  },
  // A mailbox couldn't be read (Google down, a limit, or our bug), or Google wouldn't renew its
  // notices for it (code WATCH_FAILED: the read itself went on). Tried again by itself.
  gmail_read_failed: { label: "Gmail reads failed", urgent: false },
  // Claude couldn't be asked in the middle of a read (down, a wrong key or model, a limit), so the
  // read stopped where it was and tries again later.
  gmail_reader_down: { label: "Gmail reads stopped (Claude couldn't be asked)", urgent: false },
  // Reading lost its place in a mailbox and skipped ahead: some emails weren't read.
  gmail_history_gap: { label: "Gmail mailboxes missed some emails", urgent: false },
} as const;

export type OpsEventKind = keyof typeof OPS_EVENT_KINDS;

export const OPS_ALERT_MINUTES = 60;
// Rows kept, for /admin/health's week and some looking back.
export const OPS_EVENT_DAYS = 30;
// At most this many rows per kind an hour: a flood of forged webhooks can't fill the table.
export const OPS_EVENTS_PER_KIND_HOUR = 200;
// The daily email lists at most this many error codes per kind.
export const OPS_DIGEST_CODES = 5;
