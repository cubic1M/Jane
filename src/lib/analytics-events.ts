export const ANONYMOUS_ID_COOKIE = "fc_aid";

// Events the browser may send to POST /api/events. Server-side events don't need to be listed.
export const CLIENT_EVENTS = [
  "landing_viewed",
  "get_started_clicked",
  "report_viewed",
  "card_opened",
  "link_failed",
  "insights_viewed",
  "alerts_viewed",
  "debt_planner_viewed",
  "plan_viewed",
  "loans_viewed",
  "documents_viewed",
  "insurance_viewed",
  "deadlines_viewed",
  // Taxes (spec step 118).
  "taxes_viewed",
  "investments_viewed",
] as const;

export type ClientEventName = (typeof CLIENT_EVENTS)[number];

export function isClientEvent(name: unknown): name is ClientEventName {
  return typeof name === "string" && (CLIENT_EVENTS as readonly string[]).includes(name);
}

// What goes to PostHog: the product's funnel, by name. Everything else stays in our own table. Its
// name alone can say someone has a medical bill, identity theft, money trouble or an insurance claim
// (/privacy: "Never your email, your account details or your transactions"), and a new event stays
// private until someone adds it here. An independent read found a list of what to hold back missed
// half of them.
export const POSTHOG_EVENTS: ReadonlySet<string> = new Set([
  "landing_viewed",
  "get_started_clicked",
  "report_viewed",
  "card_opened",
  "link_failed",
  "signup_completed",
  "signed_in",
  "waitlist_joined",
  "invite_opened",
  "invite_joined",
  "invite_redeemed",
  "invite_sent",
  "upload_started",
  "upload_succeeded",
  "upload_failed",
  "import_started",
  "import_completed",
  "import_failed",
  "link_started",
  "link_refused",
  "link_succeeded",
  "first_sync_completed",
  "detection_completed",
  "decision_yes",
  "decision_undone",
  "diy_done",
  "suggestion_answered",
  "chat_message_sent",
  "chat_action_taken",
  "digest_sent",
  "digest_opened",
  "digest_clicked",
  "digest_unsubscribed",
  "membership_offer_shown",
  "membership_reserved",
  "membership_checkout_started",
  "membership_paid",
]);

const POSTHOG_TEXT = new Set(["anonymous_id", "method"]);

// Numbers and yes-or-no, and only these words: a bank's or an insurer's name stays here.
export function forPostHog<T extends string | number | boolean | null>(
  properties: Record<string, T>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(properties).filter(
      ([key, value]) => typeof value !== "string" || POSTHOG_TEXT.has(key),
    ),
  );
}
