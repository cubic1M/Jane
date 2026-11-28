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
  // Claude refused Jane's API key (401, or 403 for a key not allowed): every call fails until the
  // key is replaced. The background calls only logged it ("Explanation request failed { status:
  // 401 }", "Strategist failed") and answered 200 with a template, daily from 11-17.
  claude_key_refused: { label: "Claude refused Jane's API key", urgent: true },
  // A typed question couldn't be sent to Claude (the key refused, the provider down, no answer in
  // time), so the person was told the answering service is down. The code says which.
  chat_model_unavailable: { label: "chat answers couldn't reach Claude", urgent: false },
} as const;

export type OpsEventKind = keyof typeof OPS_EVENT_KINDS;

export const OPS_ALERT_MINUTES = 60;
// Rows kept, for /admin/health's week and some looking back.
export const OPS_EVENT_DAYS = 30;
// At most this many rows per kind an hour: a flood of forged webhooks can't fill the table.
export const OPS_EVENTS_PER_KIND_HOUR = 200;
// The daily email lists at most this many error codes per kind.
export const OPS_DIGEST_CODES = 5;
