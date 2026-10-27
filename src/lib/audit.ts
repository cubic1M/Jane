import { ACCESS_EVENTS, FAILED_EVENTS, type AccessEvent } from "@/config/access-log";
import type { ActorType } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { currentRequestDetails, detailsFrom } from "@/lib/request-details";
import { scrubSecrets } from "@/lib/scrub";

// Every sensitive event goes through logAudit. Add new events here so the log stays
// queryable by a known set of names.
export type AuditEvent =
  // Loans (spec step 112): applying for credit and accepting a loan.
  | "loan_application_submitted"
  | "loan_accepted"
  // Spec step 174: applying for a credit card through Jane, only on the person's tap.
  | "card_application_submitted"
  // Spec step 177: a request for help when money is tight, sent on the person's tap.
  | "tight_request_sent"
  // Spec step 180: a request about a medical bill, sent on the person's tap.
  | "medical_request_sent"
  // Spec step 181: a validation letter or a bureau dispute, sent on the person's tap.
  | "credit_dispute_sent"
  // Spec step 224: a request for a lower card rate, sent on the person's tap.
  | "card_rate_requested"
  // Spec step 226: the person said a payment-app transfer was a loan.
  | "personal_loan_confirmed"
  // Spec step 227: the person started a plan for a credit score goal.
  | "credit_goal_started"
  | "home_equity_updated"
  | "debt_review_done"
  | "car_addon_confirmed"
  | "car_addon_cancel_requested"
  // Spec step 248: rent reporting turned on or off, a security deposit saved or returned.
  | "rent_reporting_changed"
  | "security_deposit_saved"
  // Spec step 249: credit given or got through someone close, recorded or removed.
  | "family_credit_changed"
  | "home_request_sent"
  | "user_signed_up"
  // Insurance (spec Phase X): a policy saved or removed, the household facts saved.
  | "insurance_policy_saved"
  | "insurance_policy_removed"
  | "insurance_household_saved"
  // Spec step 105: Jane bound a new policy through the insurance partner, and cancelled the
  // old one once the new one's first payment went through.
  | "insurance_policy_bound"
  | "insurance_policy_cancelled"
  // Spec step 107: a claim tracker started (the kind and what happened, never details).
  | "insurance_claim_started"
  // Spec step 150: a benefit through work confirmed (its kind, never the amounts).
  | "employer_benefit_confirmed"
  | "life_application_submitted"
  | "insurance_cover_changed"
  | "insurance_renewal_negotiated"
  | "insurance_claim_filed"
  | "insurance_saving_applied"
  | "user_signed_in"
  // The access log (src/config/access-log.ts): signing out, a sign-in that didn't work (why,
  // never the address tried), and every admin page view and admin action (the path).
  | "user_signed_out"
  | "sign_in_failed"
  | "admin_page_viewed"
  | "admin_action"
  | "import_completed"
  // Removing uploads (src/lib/import/remove.ts): what was removed, as counts only.
  | "upload_removed"
  | "uploaded_account_removed"
  | "uploads_reset"
  // Finding data was sent to Claude for card text.
  | "explanations_generated"
  | "decision_made"
  | "decision_undone"
  | "item_linked"
  // A bank signed in again (or its new accounts shared) through Link's update mode.
  | "item_relinked"
  // Admin tools: every view of user data and every status change.
  | "admin_viewed_queue"
  | "admin_viewed_action"
  | "admin_viewed_metrics"
  // The beta's activity log (/admin/activity): the list, the funnel, or one person's timeline.
  | "admin_viewed_activity"
  | "action_status_changed"
  | "membership_paid"
  | "item_removed"
  | "user_data_deleted"
  | "admin_mfa_enrolled"
  | "admin_mfa_verified"
  | "admin_mfa_failed"
  | "user_made_admin"
  | "invite_code_created"
  | "invite_code_revoked"
  | "invite_redeemed"
  | "terms_accepted"
  | "data_exported"
  | "admin_drafted_message"
  | "merchant_saved"
  | "switch_option_saved"
  | "switch_option_reviewed"
  | "switch_option_removed"
  | "diy_done"
  | "household_invite_sent"
  | "household_joined"
  | "household_left"
  | "account_sharing_changed"
  | "referral_partner_saved"
  | "referral_conversion_recorded"
  | "job_retried"
  // Key rotation (src/lib/key-rotation.ts): the key report opened, a rotation run (counts only).
  | "admin_viewed_keys"
  | "encryption_keys_rotated"
  | "action_assigned"
  | "saved_reply_saved"
  | "saved_reply_deleted"
  | "admin_viewed_health"
  | "charge_split"
  | "household_settled"
  // Two-factor for everyone (admins keep the admin_mfa_* names above).
  | "mfa_enabled"
  | "mfa_verified"
  | "mfa_failed"
  | "mfa_disabled"
  | "mfa_backup_code_used"
  | "mfa_backup_codes_created"
  | "standing_rules_saved"
  | "autopilot_set"
  // A chosen level taken back with Revert (src/lib/jane-agent/actions/choice.ts).
  | "autopilot_reverted"
  // One autopilot, every sector (spec step 141): a sector's level or caps changed.
  | "autopilot_sector_set"
  // Money that moves itself (spec steps 144–145): a transfer or payment scheduled or undone.
  | "money_transfer_scheduled"
  | "money_transfer_cancelled"
  // A what-if plan the person adopted (spec step 203).
  | "what_if_adopted"
  // The lean plan switched on or off (spec step 204).
  | "lean_plan_started"
  // The same account linked twice, merged after both sides were proven to match (spec step 238).
  | "books_merged"
  // A finished action whose saving never showed up (spec step 207).
  | "saving_marked_not_shown"
  // Unusual activity answered: this was me, or not me (spec step 208).
  | "unusual_answered"
  // Money for two (spec step 242): the household's split rule and big-move amount, a goal made
  // joint or private, and a big move waiting for, approved or declined by the other partner.
  | "household_split_set"
  | "household_big_move_set"
  | "goal_sharing_changed"
  | "money_transfer_awaiting_partner"
  | "big_move_approved"
  | "big_move_declined"
  // The order goals are funded in, picked by the person (spec step 241).
  | "goal_order_chosen"
  | "lean_plan_ended"
  | "plan_link_used"
  | "support_contact_suggested"
  | "support_contact_confirmed"
  | "proposal_answered"
  // A button on one of Jane's chat messages (spec step 81): which one, never the text.
  | "chat_action_taken"
  // What Jane remembers (spec step 91): saved on the person's tap, deleted in Settings.
  | "preference_saved"
  | "preference_deleted"
  // The action agent (src/lib/agent/run.ts).
  | "agent_message_sent"
  | "agent_reply_received"
  | "agent_handed_off"
  | "agent_call_started"
  // A refund seen coming back in the person's transactions (src/lib/agent/refund-check.ts).
  | "refund_seen"
  // Insurance policies, warranties and receipts (spec step 68). Never the file or its text.
  | "document_uploaded"
  | "document_read"
  | "document_viewed"
  | "document_facts_saved"
  | "document_deleted"
  // The tax-time pack downloaded as a CSV (spec step 72).
  | "tax_pack_downloaded"
  // Spec step 171: the audit pack for a year downloaded.
  | "audit_pack_downloaded"
  // Spec step 172: a prior-year return read from a document was confirmed; an amended
  // return was prepared and signed.
  | "tax_return_read_confirmed"
  | "tax_amendment_started"
  | "tax_amendment_signed"
  // Spec step 217: a tax notice confirmed; its response handed to the team or the person.
  | "tax_notice_confirmed"
  // Spec step 218: a case opened on a sign of tax identity theft.
  | "tax_identity_case_opened"
  | "tax_notice_response_sent"
  // Spec step 221: who files a drafted property tax appeal (the team or the person).
  | "property_appeal_handled"
  // Spec step 222: a read-only link for an accountant made, viewed, answered on and revoked.
  // Spec step 223: an estimated tax payment made through the stand-in.
  | "tax_payment_made"
  // Spec step 270: tax deadlines moved by a disaster postponement, and a disaster loss recorded
  // with its insurance claim.
  | "tax_deadlines_postponed"
  | "disaster_loss_recorded"
  | "accountant_link_created"
  | "accountant_link_viewed"
  | "accountant_link_answered"
  | "accountant_link_revoked"
  // Taxes (spec steps 118–127): which fields of the tax profile changed, never the answers.
  | "tax_profile_changed"
  // A tax tag the person changed (spec step 119): the tag and whether on one transaction or
  // a merchant, never which.
  | "tax_tag_changed"
  // Filing (spec step 126): a return started with the filing partner, and signed.
  | "tax_return_started"
  | "tax_return_signed"
  // Spec step 166: a tax form collected from the document partner, and the person's call on
  // one that doesn't match their accounts.
  | "tax_document_collected"
  | "tax_document_decided"
  // Spec step 168: a donor-advised fund opened with the stand-in (no money moves).
  | "donor_fund_opened"
  // Devices and sessions (spec step 73): one other session, or all the others, signed out.
  | "session_signed_out"
  | "other_sessions_signed_out"
  // One of Jane's chat messages went out as a notification (spec step 85): the channel
  // and the kind of message, never its text.
  | "chat_notification_sent"
  // What the investments are for (spec step 129): which answer changed, never the answers.
  | "investor_profile_saved"
  // Orders sent to the brokerage partner (spec step 133): how many, why, and whether the
  // partner was the simulation; never amounts or tickers.
  | "brokerage_orders_placed"
  // Automatic investing (spec step 134): started, paused, resumed or changed; never amounts.
  | "auto_invest_set"
  // College savings set up (spec step 158): the kind of college, never the child's details.
  | "college_plan_saved"
  // A company stock grant from the guided form (spec step 160): its kind, never amounts.
  | "equity_grant_saved"
  // A read-only crypto connection (spec step 161): exchange or wallet, never a key.
  | "crypto_connected"
  // Spec step 164: Jane acted on its own in the investing sector, within the person's caps.
  | "autopilot_investing_acted"
  // Spec step 210: a change to a contribution at work, sent to the payroll partner.
  | "payroll_change_requested"
  // Spec step 211: an old retirement plan found, and its direct rollover.
  | "old_plan_found"
  | "rollover_started"
  | "rollover_completed"
  // Spec step 212: the person's retirement income answers saved (never the amounts).
  | "retirement_income_saved"
  // Spec step 213: a gift link made or taken down (never the link itself), and a gift received.
  | "gift_link_created"
  | "gift_link_revoked"
  | "gift_received"
  // Spec step 214: a rental property added (never its figures).
  | "rental_added"
  // Spec step 215: a costly product entered or confirmed (never its figures).
  | "costly_product_saved"
  // Spec step 232: a plan's fund menu confirmed, and a change to the plan's funds requested.
  | "plan_menu_confirmed"
  | "plan_change_requested"
  // Spec step 234: a Treasury bill ladder started, and a bill rolled into the next.
  | "ladder_started"
  | "ladder_rolled"
  // Spec step 235: sudden money classed (the kind, never the amount), and a stage done.
  | "sudden_money_classed"
  | "sudden_money_stage"
  // Spec step 236: values listed (the keys, never amounts), and a switch into screened funds.
  | "values_saved"
  | "values_switch"
  // Spec step 237: beneficiaries named or confirmed, and the family file picked or shared.
  | "beneficiary_saved"
  | "family_file_picked"
  | "family_file_exported"
  // Spec step 290 (Phase AW): the practice portfolio started, and each practice trade.
  | "practice_started"
  // The paper account (src/lib/paper/): started, a trade from the pop-up, reverted, skipped.
  | "paper_account_started"
  | "paper_trade_taken"
  | "paper_trade_reverted"
  // The 24-hour agent (src/lib/trading-agent/agent.ts), on simulated money.
  | "paper_agent_started"
  | "paper_agent_stopped"
  | "paper_signal_skipped"
  // The events overlay on the paper account (src/lib/events/run.ts): switched on or off.
  | "paper_events_switched"
  | "practice_trade"
  // The person's practice-portfolio preferences changed, from the page or the chat (which fields,
  // never the amounts).
  | "practice_preferences_changed";

export type AuditActor = { type: ActorType; id: string | null };

export type AuditTarget = { type: string; id: string } | null;

// Never put secrets (tokens, keys, raw bank data) in metadata. logAudit drops any key named
// like one and scrubs credentials out of values anyway, as a second line.
export type AuditMetadata = Record<string, string | number | boolean | null>;

export const SYSTEM_ACTOR: AuditActor = { type: "system", id: null };

const SECRET_KEY = /token|secret|password|authorization|cookie|api_?key|credential/i;

export function safeMetadata(metadata: AuditMetadata): AuditMetadata {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => !SECRET_KEY.test(key))
      .map(([key, value]) => [key, typeof value === "string" ? scrubSecrets(value) : value]),
  );
}

export const isAccessEvent = (event: AuditEvent): event is AccessEvent =>
  (ACCESS_EVENTS as readonly string[]).includes(event);

// Access-log entries also keep where the request came from and how it went. `headers` is for
// callers outside a page or action (the proxy); otherwise the current request's are read.
export async function logAudit(
  actor: AuditActor,
  event: AuditEvent,
  target: AuditTarget,
  metadata: AuditMetadata = {},
  { headers }: { headers?: Headers } = {},
): Promise<void> {
  const access = isAccessEvent(event)
    ? {
        outcome: FAILED_EVENTS.includes(event) ? "failure" : "success",
        ...(headers ? detailsFrom(headers) : await currentRequestDetails()),
      }
    : {};
  await db.auditLog.create({
    data: {
      actorType: actor.type,
      actorId: actor.id,
      event,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      metadata: { ...access, ...safeMetadata(metadata) },
    },
  });
}
