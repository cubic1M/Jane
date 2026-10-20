import type { ActorType } from "@/generated/prisma/client";
import { db } from "@/lib/db";

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
  | "import_completed"
  // Finding data was sent to Claude for card text.
  | "explanations_generated"
  | "decision_made"
  | "decision_undone"
  | "item_linked"
  // Admin tools: every view of user data and every status change.
  | "admin_viewed_queue"
  | "admin_viewed_action"
  | "admin_viewed_metrics"
  | "action_status_changed"
  | "membership_paid"
  | "item_removed"
  | "user_data_deleted"
  | "admin_mfa_enrolled"
  | "admin_mfa_verified"
  | "admin_mfa_failed"
  | "user_made_admin"
  | "invite_code_created"
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
  // One autopilot, every sector (spec step 141): a sector's level or caps changed.
  | "autopilot_sector_set"
  // Money that moves itself (spec steps 144–145): a transfer or payment scheduled or undone.
  | "money_transfer_scheduled"
  | "money_transfer_cancelled"
  // A what-if plan the person adopted (spec step 203).
  | "what_if_adopted"
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
  | "tax_notice_response_sent"
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
  | "crypto_connected";

export type AuditActor = { type: ActorType; id: string | null };

export type AuditTarget = { type: string; id: string } | null;

// Never put secrets (tokens, keys, raw bank data) in metadata.
export type AuditMetadata = Record<string, string | number | boolean | null>;

export const SYSTEM_ACTOR: AuditActor = { type: "system", id: null };

export async function logAudit(
  actor: AuditActor,
  event: AuditEvent,
  target: AuditTarget,
  metadata: AuditMetadata = {},
): Promise<void> {
  await db.auditLog.create({
    data: {
      actorType: actor.type,
      actorId: actor.id,
      event,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      metadata,
    },
  });
}
