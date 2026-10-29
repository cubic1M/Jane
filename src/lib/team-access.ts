import type { AuditEvent } from "@/lib/audit";

// Who saw my data (spec step 74): which audit events are the concierge team or Jane's
// agent viewing or acting on one person's data, how to tell whose, and how to say it in
// plain words. Pure; src/lib/team-access-loader.ts reads the log.

export const TEAM = "Our concierge team";
export const AGENT = "Jane's agent";
export type Who = typeof TEAM | typeof AGENT;

// Why an event isn't on the page:
// - own: the person's own doing (signing in, deciding, uploading, exporting…), or an
//   admin's own account (two-factor, being made an admin)
// - automatic: Jane's automatic processing, not the team or the agent looking at them
// - not_one_person: the team's own tools (directory, options, partners, invites, saved
//   replies, jobs, metrics, health), which hold no one person's data
type Hidden = { shown: false; because: "own" | "automatic" | "not_one_person" };

type Metadata = Record<string, unknown>;

// How a shown event names its person:
// - action: targets one of their actions (or carries their id as metadata user_id)
// - queue: targets the person (target user) and lists their action ids in action_ids
// - person: targets the person (target user), about no one request
type Shown = {
  shown: true;
  whose: "action" | "queue" | "person";
  what: (metadata: Metadata, company: string | null) => string;
};

export type EventRule = Hidden | Shown;

const own: Hidden = { shown: false, because: "own" };
const automatic: Hidden = { shown: false, because: "automatic" };
const notOnePerson: Hidden = { shown: false, because: "not_one_person" };

const onAction = (what: Shown["what"]): Shown => ({ shown: true, whose: "action", what });
const named = (company: string | null) => company ?? "the company";

const STATUS_WORDS: Record<string, string> = {
  queued: "Put it back in the queue",
  in_progress: "Started working on it",
  waiting_on_user: "Asked you for something",
  done: "Marked it done",
  failed: "Marked it as not possible",
};

// Every audit event, with a decision. Typed over AuditEvent, so a new event can't be added
// to src/lib/audit.ts without deciding here whether people see it.
export const TEAM_ACCESS_RULES: Record<AuditEvent, EventRule> = {
  user_signed_up: own,
  // The weekly email: Jane's automatic send, and the person's own unsubscribe.
  digest_sent: automatic,
  digest_unsubscribed: own,
  // Loans (spec step 112): the person's own application and acceptance.
  loan_application_submitted: own,
  loan_accepted: own,
  // Spec step 174: the person's own card application.
  card_application_submitted: own,
  // Spec step 177: the person's own request for a due-date move, hardship help and so on.
  tight_request_sent: own,
  // Spec step 180: the person's own request about a medical bill.
  medical_request_sent: own,
  // Spec step 181: the person's own validation letter or bureau dispute.
  credit_dispute_sent: own,
  // Spec step 224: the person's own request for a lower card rate.
  card_rate_requested: own,
  // Spec step 226: the person's own answer about a loan to or from someone they know.
  personal_loan_confirmed: own,
  // Spec step 227: the person's own credit score plan.
  credit_goal_started: own,
  home_equity_updated: own,
  debt_review_done: own,
  car_addon_confirmed: own,
  car_addon_cancel_requested: own,
  rent_reporting_changed: own,
  security_deposit_saved: own,
  family_credit_changed: own,
  home_request_sent: own,
  // Insurance (spec Phase X): the person's own edits to their profile.
  insurance_policy_saved: own,
  insurance_policy_removed: own,
  insurance_household_saved: own,
  insurance_policy_bound: automatic,
  insurance_policy_cancelled: automatic,
  insurance_claim_started: own,
  employer_benefit_confirmed: own,
  life_application_submitted: own,
  insurance_cover_changed: own,
  insurance_renewal_negotiated: own,
  insurance_claim_filed: own,
  insurance_saving_applied: own,
  user_signed_in: own,
  user_signed_out: own,
  // The access log (src/config/access-log.ts): a failed sign-in has no known person, and the
  // team's page views and actions by path are covered, per person, by the named events below
  // (admin_viewed_queue, admin_viewed_action, action_status_changed).
  sign_in_failed: notOnePerson,
  admin_page_viewed: notOnePerson,
  admin_action: notOnePerson,
  import_completed: own,
  positions_imported: own,
  upload_removed: own,
  uploaded_account_removed: own,
  uploads_reset: own,
  uploaded_balance_set: own,
  problem_reported: own,
  explanations_generated: automatic,
  decision_made: own,
  decision_undone: own,
  item_linked: own,
  item_relinked: own,
  admin_viewed_queue: {
    shown: true,
    whose: "queue",
    what: () => "Saw your request in the team's list",
  },
  admin_viewed_action: onAction(() => "Viewed your request"),
  admin_viewed_metrics: notOnePerson,
  // The beta's activity log: the list holds no one person's data; their own timeline does.
  admin_viewed_activity: {
    shown: true,
    whose: "person",
    what: () => "Looked at how you used Jane (pages and buttons, not what you typed)",
  },
  action_status_changed: onAction((m) =>
    m.from === m.to ? "Updated its notes" : (STATUS_WORDS[String(m.to)] ?? "Updated its status"),
  ),
  membership_paid: automatic,
  // By the person, or automatically when a bank sat unused (spec step 11).
  item_removed: own,
  user_data_deleted: own,
  admin_mfa_enrolled: own,
  admin_mfa_verified: own,
  admin_mfa_failed: own,
  user_made_admin: own,
  invite_code_created: notOnePerson,
  invite_code_revoked: notOnePerson,
  invite_redeemed: notOnePerson,
  terms_accepted: own,
  data_exported: own,
  admin_drafted_message: onAction(() => "Drafted a message for it"),
  merchant_saved: notOnePerson,
  switch_option_saved: notOnePerson,
  switch_option_reviewed: notOnePerson,
  switch_option_removed: notOnePerson,
  diy_done: own,
  household_invite_sent: own,
  household_joined: own,
  household_left: own,
  account_sharing_changed: own,
  referral_partner_saved: notOnePerson,
  referral_conversion_recorded: onAction(() => "Noted the partner's payment for it"),
  job_retried: notOnePerson,
  action_assigned: onAction((m) =>
    m.to ? "Gave it to a team member" : "Took it off a team member's list",
  ),
  saved_reply_saved: notOnePerson,
  saved_reply_deleted: notOnePerson,
  admin_viewed_health: notOnePerson,
  // Key rotation re-locks everyone's values without reading them; the report is counts only.
  admin_viewed_keys: notOnePerson,
  encryption_keys_rotated: notOnePerson,
  charge_split: own,
  household_settled: own,
  mfa_enabled: own,
  mfa_verified: own,
  mfa_failed: own,
  mfa_disabled: own,
  mfa_backup_code_used: own,
  mfa_backup_codes_created: own,
  standing_rules_saved: own,
  autopilot_set: own,
  autopilot_reverted: own,
  autopilot_sector_set: own,
  money_transfer_scheduled: own,
  money_transfer_cancelled: own,
  what_if_adopted: own,
  lean_plan_started: own,
  books_merged: own,
  saving_marked_not_shown: own,
  saving_state_changed: own,
  unusual_answered: own,
  household_split_set: own,
  household_big_move_set: own,
  goal_sharing_changed: own,
  money_transfer_awaiting_partner: own,
  big_move_approved: own,
  big_move_declined: own,
  goal_order_chosen: own,
  lean_plan_ended: own,
  plan_link_used: own,
  // Found on the company's own website; about a company, not a person.
  support_contact_suggested: notOnePerson,
  support_contact_confirmed: notOnePerson,
  proposal_answered: own,
  chat_action_taken: own,
  preference_saved: own,
  preference_deleted: own,
  memory_fact_corrected: own,
  memory_fact_deleted: own,
  memory_deleted_all: own,
  agent_message_sent: onAction((m, company) =>
    m.follow_up === true ? `Wrote to ${named(company)} again` : `Wrote to ${named(company)}`,
  ),
  agent_reply_received: onAction((_, company) =>
    company ? `Read ${company}'s reply` : "Read the company's reply",
  ),
  agent_handed_off: onAction(() => "Passed it to the team"),
  agent_call_started: onAction((_, company) => `Called ${named(company)}`),
  refund_seen: onAction(() => "Saw your refund come in"),
  document_uploaded: own,
  // Claude reads a document the person uploads, as part of their upload.
  document_read: own,
  document_viewed: own,
  document_facts_saved: own,
  document_deleted: own,
  tax_pack_downloaded: own,
  audit_pack_downloaded: own,
  tax_return_read_confirmed: own,
  tax_amendment_started: own,
  tax_amendment_signed: own,
  tax_notice_confirmed: own,
  tax_identity_case_opened: own,
  tax_notice_response_sent: own,
  property_appeal_handled: own,
  tax_payment_made: own,
  tax_deadlines_postponed: own,
  disaster_loss_recorded: own,
  accountant_link_created: own,
  accountant_link_viewed: own,
  accountant_link_answered: own,
  accountant_link_revoked: own,
  tax_profile_changed: own,
  tax_tag_changed: own,
  tax_return_started: own,
  tax_return_signed: own,
  tax_document_collected: own,
  tax_document_decided: own,
  donor_fund_opened: own,
  session_signed_out: own,
  other_sessions_signed_out: own,
  // Jane's chat messages as notifications (spec step 85).
  chat_notification_sent: automatic,
  investor_profile_saved: own,
  brokerage_orders_placed: own,
  auto_invest_set: own,
  college_plan_saved: own,
  equity_grant_saved: own,
  crypto_connected: own,
  autopilot_investing_acted: own,
  payroll_change_requested: own,
  old_plan_found: own,
  rollover_started: own,
  rollover_completed: own,
  retirement_income_saved: own,
  gift_link_created: own,
  gift_link_revoked: own,
  gift_received: own,
  rental_added: own,
  costly_product_saved: own,
  plan_menu_confirmed: own,
  plan_change_requested: own,
  ladder_started: own,
  ladder_rolled: own,
  sudden_money_classed: own,
  sudden_money_stage: own,
  values_saved: own,
  values_switch: own,
  beneficiary_saved: own,
  family_file_picked: own,
  family_file_exported: own,
  practice_started: own,
  practice_trade: own,
  practice_preferences_changed: own,
  paper_account_started: own,
  paper_trade_taken: own,
  paper_trade_reverted: own,
  paper_signal_skipped: own,
  paper_agent_started: own,
  paper_agent_stopped: own,
  paper_events_switched: own,
};

export const SHOWN_EVENTS = (Object.keys(TEAM_ACCESS_RULES) as AuditEvent[]).filter(
  (event) => TEAM_ACCESS_RULES[event].shown,
);

// One audit_log row, as the loader reads it.
export type AuditRow = {
  id: string;
  event: string;
  actorType: "user" | "admin" | "system";
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
};

// The person's actions: the title they saw on the card, and the company when known.
export type ActionInfo = { title: string; company: string | null };

export type TeamAccessEntry = {
  key: string;
  at: Date;
  who: Who;
  what: string;
  // The action's title, or UNDONE_WHY for an action that's since been undone (and deleted).
  why: string;
  // Null when the action no longer exists.
  actionId: string | null;
};

export const UNDONE_WHY = "A request you've since undone";
// Why for a look at the person rather than a request: the beta's activity log.
export const PERSON_WHY = "To improve Jane during the beta";

const metadataOf = (value: unknown): Metadata =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Metadata) : {};

const idsOf = (value: unknown): string[] =>
  typeof value === "string" ? value.split(",").filter((id) => id.length > 0) : [];

// Pure: the person's team access entries from audit rows, newest first. Rows that aren't
// the team or the agent about this person's data are dropped, whatever the query returned,
// so a loose query can't show someone else's entries. The actor's id is never copied.
export function teamAccessEntries(
  rows: AuditRow[],
  { userId, actions }: { userId: string; actions: Map<string, ActionInfo> },
): TeamAccessEntry[] {
  const entries: TeamAccessEntry[] = [];
  for (const row of rows) {
    const rule = (TEAM_ACCESS_RULES as Record<string, EventRule | undefined>)[row.event];
    if (!rule?.shown) continue;
    // Their own doing, even as an admin, isn't the team looking at their data.
    if (row.actorType === "user" || row.actorId === userId) continue;
    const who: Who = row.actorType === "admin" ? TEAM : AGENT;
    const metadata = metadataOf(row.metadata);

    if (rule.whose === "person") {
      if (row.targetType !== "user" || row.targetId !== userId) continue;
      entries.push({
        key: row.id,
        at: row.createdAt,
        who,
        what: rule.what(metadata, null),
        why: PERSON_WHY,
        actionId: null,
      });
      continue;
    }
    let actionIds: string[];
    if (rule.whose === "queue") {
      if (row.targetType !== "user" || row.targetId !== userId) continue;
      actionIds = idsOf(metadata.action_ids);
    } else {
      if (row.targetType !== "action" || !row.targetId) continue;
      const theirs = actions.has(row.targetId) || metadata.user_id === userId;
      if (!theirs) continue;
      actionIds = [row.targetId];
    }

    for (const actionId of actionIds) {
      const action = actions.get(actionId);
      entries.push({
        key: `${row.id}:${actionId}`,
        at: row.createdAt,
        who,
        what: rule.what(metadata, action?.company ?? null),
        why: action?.title ?? UNDONE_WHY,
        actionId: action ? actionId : null,
      });
    }
  }
  return entries.sort((a, b) => b.at.getTime() - a.at.getTime() || b.key.localeCompare(a.key));
}
