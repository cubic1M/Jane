// Data retention (spec step 11).

// Linked banks are removed from Plaid after this many days without the person using the
// app, so we stop paying for (and holding) connections nobody uses.
export const INACTIVE_ITEM_DAYS = 60;

// We email this many days before removing them.
export const REMOVAL_WARNING_DAYS = 7;

// Things only a person does; system work like syncs doesn't count as activity.
export const ACTIVITY_EVENTS: readonly string[] = [
  "signed_in",
  "report_viewed",
  "insights_viewed",
  "alerts_viewed",
  "card_opened",
  "decision_yes",
  "decision_no",
  "decision_undone",
  "digest_clicked",
  "link_started",
  "link_succeeded",
  "import_completed",
  "membership_reserved",
  "membership_checkout_started",
];
